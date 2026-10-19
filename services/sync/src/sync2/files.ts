/** Every file of a space that is not a note: a picture, a recording, a PDF, anything
 *  (docs/sync-v2.md section 5.8).
 *
 *  In the tree such a file is an entry of kind `file` with a hash and a size, and its
 *  bytes are a blob addressed by that hash - the same `blobs` rows and the same
 *  `blobs/<hash>` objects pictures already use, counted against the uploading account
 *  as they always were. Nothing merges: a replacement is a new hash, the later arrival
 *  stands, and a device replacing a file another replaced while it was away is told
 *  so and asks its person.
 *
 *  Three roads in, one out. Bytes up to 64 MB go up in one request, larger ones in
 *  8 MB parts through R2's multipart upload; either way the hash is checked against the
 *  bytes, since a blob named by a hash is shared by everybody who holds the same file
 *  and a wrong name would hand them somebody else's. And the bytes come back down
 *  through the space, to its members only: `/i/<hash>` serves what a published page
 *  points at and nothing else. */

import { Hono } from 'hono'
import { now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { nextSeq } from '../notes'
import { OUT_OF_SPACE } from '../refused'
import { atLeast, spaceOf } from '../spaces/space'
import { fits } from '../storage'
import type { Env, Note, Variables } from '../types'
import { deviceOf } from './device'
import { revive } from './ops'

interface App {
  Bindings: Env
  Variables: Variables
}

const HASH = /^[a-f0-9]{64}$/

/** The largest file that goes up in one request; past it, parts. A Worker holds a
 *  request's body in 128 MB of memory, and hashes it there. */
const ONE_REQUEST = 64 * 1024 * 1024

/** How big a part is. R2 takes parts of at least 5 MB, all but the last the same size. */
const PART = 8 * 1024 * 1024

/** The largest file a space keeps: the account's whole quota is the other bound. */
const LARGEST = 1024 * 1024 * 1024

/** A file nobody can reach, or one that is not a file. A reader can bring it about -
 *  opening a file somebody removed a moment ago - so it has a row in every catalogue. */
export const NO_SUCH_FILE = 'no such file'

/** Bytes whose hash is not the name they arrived under. A correct client never sends
 *  these, so it reaches no reader and stays English. */
export const WRONG_BYTES = 'those bytes are not that hash'
const NOT_A_HASH = 'that is not a hash'
const TOO_BIG = 'that file is too big'

/** The types a blob keeps as they were declared: what `/i/` serves a published page,
 *  and what the v1 routes take. Anything else is kept as bytes and nothing more, so no
 *  file anybody syncs is ever served as a page on this origin. */
const DECLARED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
])
export const BYTES = 'application/octet-stream'

function typeOf(header: string | undefined): string {
  const type = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return DECLARED.has(type) ? type : BYTES
}

/** Where a file's bytes are kept: by their hash, so one blob serves every copy. */
export function blobKey(hash: string): string {
  return `blobs/${hash}`
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The hash a blob is named by, of bytes in hand. */
export async function hashOfBytes(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

/** A Worker's streaming hasher, which Node has no equivalent of. */
type DigestStreaming = new (algorithm: string) => WritableStream & { digest: Promise<ArrayBuffer> }

/** The hash of an object in the bucket, read as a stream where the runtime can hash
 *  one (a Worker's `DigestStream`), and whole where it cannot. */
export async function hashOf(object: R2ObjectBody): Promise<string> {
  // Read off the runtime rather than its types, which describe only one of the two.
  const Streaming = (crypto as unknown as { DigestStream?: DigestStreaming }).DigestStream
  if (Streaming) {
    const stream = new Streaming('SHA-256')
    await object.body.pipeTo(stream)
    return hex(await stream.digest)
  }
  return hex(await crypto.subtle.digest('SHA-256', await object.arrayBuffer()))
}

/** A Worker's stream that tells R2 how long it is, which Node has no equivalent of. */
type FixedLength = new (length: number) => TransformStream<Uint8Array, Uint8Array>

/** An object copied to another name, as a stream where the runtime can say how long
 *  one is (a Worker's `FixedLengthStream`, which R2 asks of a stream it is given), and
 *  whole where it cannot - a gigabyte of file never sits in a Worker's memory. */
async function moveInto(env: Env, from: string, to: string, type: string): Promise<void> {
  const object = await env.NOTES.get(from)
  if (!object) return
  const Fixed = (globalThis as unknown as { FixedLengthStream?: FixedLength }).FixedLengthStream
  const metadata = { httpMetadata: { contentType: type } }
  if (Fixed) {
    const { readable, writable } = new Fixed(object.size)
    await Promise.all([object.body.pipeTo(writable), env.NOTES.put(to, readable, metadata)])
    return
  }
  await env.NOTES.put(to, await object.arrayBuffer(), metadata)
}

/** A row saying this account keeps a blob, once its bytes are there. */
async function keepBlob(env: Env, user: string, hash: string, size: number, type: string) {
  await env.DB.prepare(
    `insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)
     on conflict(hash, user_id) do nothing`,
  )
    .bind(hash, user, size, type, now())
    .run()
}

/** Whether this account keeps a blob already, and whether anybody's bytes are there. */
export async function held(
  env: Env,
  user: string,
  hash: string,
): Promise<{ mine: boolean; there: boolean }> {
  const row = await env.DB.prepare(
    'select max(user_id = ?) as mine, count(*) as rows from blobs where hash = ?',
  )
    .bind(user, hash)
    .first<{ mine: number | null; rows: number }>()
  return { mine: row?.mine === 1, there: (row?.rows ?? 0) > 0 }
}

/** Whether the object under a hash is the bytes that hash names, for an upload that has
 *  just checked its own bytes against it and is about to keep the copy that is there.
 *
 *  Not taken on trust because a row is there: v1 keeps a drawn diagram's SVG under a
 *  name that is not the hash of its bytes (blobs.ts), so a name somebody else wrote
 *  first may hold anything. A copy of another size is not these bytes; one of the
 *  same size is hashed. */
export async function holdsItsName(env: Env, hash: string, size: number): Promise<boolean> {
  const object = await env.NOTES.get(blobKey(hash))
  if (!object) return false
  // Another size is another file, and its body is never read.
  if (object.size !== size) return false
  return (await hashOf(object)) === hash
}

/** How many hashes one night's look for misnamed copies reads, a page at a time. */
const MISNAMED_PAGE = 100
const MISNAMED_AT_MOST = 1000

/** Copies kept under a hash they are not the bytes of, taken away by the nightly job.
 *
 *  Before uploads checked the copy that was already there (`holdsItsName`), an SVG v1
 *  kept unchecked under somebody else's file's hash was what everybody who uploaded
 *  that file afterwards was served. Such a hash is held both as an SVG - the only
 *  type v1 keeps unchecked - and as something else, by whoever uploaded the real
 *  file. Where its copy is not the bytes the hash names, the copy and every row of it
 *  go: the file reads as missing rather than as somebody else's bytes, and the next
 *  upload of the real one is kept, as the first of it. A hash held only as an SVG is a
 *  drawn diagram's, named by its fence, and is left alone. */
export async function sweepMisnamed(env: Env): Promise<number> {
  let after = ''
  let gone = 0
  for (let read = 0; read < MISNAMED_AT_MOST; read += MISNAMED_PAGE) {
    const { results } = await env.DB.prepare(
      `select distinct hash from blobs
        where type = 'image/svg+xml' and hash > ?
          and hash in (select hash from blobs where type != 'image/svg+xml')
        order by hash limit ?`,
    )
      .bind(after, MISNAMED_PAGE)
      .all<{ hash: string }>()

    for (const { hash } of results) {
      const object = await env.NOTES.get(blobKey(hash))
      if (object && (await hashOf(object)) === hash) continue
      await env.NOTES.delete(blobKey(hash))
      await env.DB.prepare('delete from blobs where hash = ?').bind(hash).run()
      gone++
    }

    const last = results.at(-1)
    if (!last || results.length < MISNAMED_PAGE) break
    after = last.hash
  }
  return gone
}

export const v2Blobs = new Hono<App>()

/** A file's bytes, in one request. The object already there - somebody else's copy of
 *  the same file - is not written again, so what a published page is served stays
 *  what it was. Unless it is not the same bytes (`holdsItsName`): then these, which
 *  are, take its place for everybody who keeps that hash. */
v2Blobs.put('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)
  if (Number(context.req.header('content-length') ?? 0) > ONE_REQUEST) {
    return context.json({ error: TOO_BIG }, 413)
  }

  const { mine, there } = await held(context.env, user.id, hash)
  if (mine) return context.json({ hash, stored: false })

  const body = await context.req.arrayBuffer()
  if (body.byteLength > ONE_REQUEST) return context.json({ error: TOO_BIG }, 413)
  if ((await hashOfBytes(body)) !== hash) {
    return context.json({ error: WRONG_BYTES }, 400)
  }
  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const type = typeOf(context.req.header('content-type'))
  if (!there || !(await holdsItsName(context.env, hash, body.byteLength))) {
    await context.env.NOTES.put(blobKey(hash), body, { httpMetadata: { contentType: type } })
  }
  await keepBlob(context.env, user.id, hash, body.byteLength, type)
  return context.json({ hash, stored: true }, 201)
})

/** What a multipart upload in flight remembers: whose, which hash, how big, and where
 *  its parts are put together. Kept in `cached` for a day, as
 *  `user:hash:size:type:staging`, which is also how deleting the account finds it; see
 *  erase.ts. */
const UPLOADS = 'upload'
const A_DAY = 24 * 60 * 60 * 1000

interface Upload {
  user: string
  hash: string
  size: number
  type: string
  /** Where the parts go: never the blob's own name, because the parts are put together
   *  before anything has checked them, and a copy somebody else finished meanwhile may
   *  be living there. */
  staging: string
}

/** Somewhere of this upload's own for its parts. */
function stagingKey(hash: string): string {
  return `uploads/${hash}/${crypto.randomUUID()}`
}

async function uploadOf(env: Env, id: string, user: string): Promise<Upload | null> {
  const row = await env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind(UPLOADS, id, now())
    .first<{ value: string }>()
  const [owner, hash, size, type, staging] = (row?.value ?? '').split(':')
  if (owner !== user || !hash || !size || !type || !staging) return null
  return { user: owner, hash, size: Number(size), type: decodeURIComponent(type), staging }
}

/** A large file, started: answers the upload to send parts to, and how big a part is;
 *  or that nothing needs sending. */
v2Blobs.post('/parts', async (context) => {
  const user = context.get('user')
  const body: unknown = await context.req.json().catch(() => null)
  const { hash, size, type } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >
  if (typeof hash !== 'string' || !HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > LARGEST) {
    return context.json({ error: TOO_BIG }, 413)
  }

  if ((await held(context.env, user.id, hash)).mine) return context.json({ hash, stored: false })
  if (!(await fits(context.env, user.id, size))) return context.json({ error: OUT_OF_SPACE }, 507)

  // Sent in full even when somebody else's copy is already here. A row is what lets a
  // file entry, a face or a post name a blob, so it is had for the bytes and never for
  // knowing their hash; once they are checked, the copy that is there is kept as it is.
  const declared = typeOf(typeof type === 'string' ? type : undefined)

  const staging = stagingKey(hash)
  const upload = await context.env.NOTES.createMultipartUpload(staging, {
    httpMetadata: { contentType: declared },
  })
  await context.env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind(
      UPLOADS,
      upload.uploadId,
      `${user.id}:${hash}:${String(size)}:${encodeURIComponent(declared)}:${staging}`,
      now() + A_DAY,
    )
    .run()

  return context.json({ upload: upload.uploadId, part: PART }, 201)
})

/** One part of a large file. */
v2Blobs.put('/parts/:upload/:part', async (context) => {
  const user = context.get('user')
  const upload = await uploadOf(context.env, context.req.param('upload'), user.id)
  if (!upload) return context.json({ error: NO_SUCH_FILE }, 404)

  const part = Number(context.req.param('part'))
  if (!Number.isSafeInteger(part) || part < 1 || part > 10_000) {
    return context.json({ error: TOO_BIG }, 413)
  }
  const body = await context.req.arrayBuffer()
  if (body.byteLength > PART) return context.json({ error: TOO_BIG }, 413)

  const uploading = context.env.NOTES.resumeMultipartUpload(
    upload.staging,
    context.req.param('upload'),
  )
  const uploaded = await uploading.uploadPart(part, body)
  return context.json({ part: uploaded.partNumber, etag: uploaded.etag })
})

/** A large file, finished: the parts put together, measured and hashed, and kept only
 *  when they are the bytes the upload named. */
v2Blobs.post('/parts/:upload', async (context) => {
  const user = context.get('user')
  const id = context.req.param('upload')
  const upload = await uploadOf(context.env, id, user.id)
  if (!upload) return context.json({ error: NO_SUCH_FILE }, 404)

  const body: unknown = await context.req.json().catch(() => null)
  const listed =
    typeof body === 'object' && body !== null ? (body as { parts?: unknown }).parts : null
  if (!Array.isArray(listed)) return context.json({ error: WRONG_BYTES }, 400)
  const parts: R2UploadedPart[] = []
  for (const one of listed as unknown[]) {
    const { part, etag } = (typeof one === 'object' && one !== null ? one : {}) as Record<
      string,
      unknown
    >
    if (typeof part !== 'number' || typeof etag !== 'string')
      return context.json({ error: WRONG_BYTES }, 400)
    parts.push({ partNumber: part, etag })
  }

  await context.env.NOTES.resumeMultipartUpload(upload.staging, id).complete(parts)
  await context.env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind(UPLOADS, id)
    .run()

  const staged = await context.env.NOTES.get(upload.staging)
  const right =
    staged !== null && staged.size === upload.size && (await hashOf(staged)) === upload.hash
  if (!right) {
    await context.env.NOTES.delete(upload.staging)
    return context.json({ error: WRONG_BYTES }, 400)
  }

  // Checked, so they go where the blob lives - unless a copy somebody else finished
  // meanwhile is already there, which is the same bytes and stays as it is. Only if it
  // is: see `holdsItsName`.
  if (
    !(await held(context.env, user.id, upload.hash)).there ||
    !(await holdsItsName(context.env, upload.hash, upload.size))
  ) {
    await moveInto(context.env, upload.staging, blobKey(upload.hash), upload.type)
  }
  await context.env.NOTES.delete(upload.staging)
  await keepBlob(context.env, user.id, upload.hash, upload.size, upload.type)
  return context.json({ hash: upload.hash, stored: true }, 201)
})

export const v2Files = new Hono<App>()

/** The file entry a route names, in the space it names. */
async function fileIn(env: Env, spaceId: string, id: string): Promise<Note | null> {
  return await env.DB.prepare("select * from notes where id = ? and space_id = ? and kind = 'file'")
    .bind(id, spaceId)
    .first<Note>()
}

/** A file's bytes, for somebody in its space. */
v2Files.get('/:space/:id', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const file = await fileIn(context.env, space.id, context.req.param('id'))
  if (!file || file.deleted) return context.json({ error: NO_SUCH_FILE }, 404)

  const object = await context.env.NOTES.get(blobKey(file.hash))
  if (!object) return context.json({ error: NO_SUCH_FILE }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': BYTES,
      'content-length': String(object.size),
      // Its bytes never change under one hash, and they are this space's, not the
      // world's: kept by the device that asked and by nothing in between.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${file.hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})

/** A file replaced: its entry now names new bytes, which this account keeps. Written
 *  only over the bytes the device replaced (`base`); a file replaced elsewhere since
 *  answers `moved` with what it is now, and the device asks its person (section 5.8).
 *  A file deleted meanwhile comes back, since an edit beats a delete. */
v2Files.put('/:space/:id', atLeast('write', 'space'), async (context) => {
  const space = spaceOf(context)
  const id = context.req.param('id')
  const body: unknown = await context.req.json().catch(() => null)
  const { hash, base } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >
  if (typeof hash !== 'string' || !HASH.test(hash) || typeof base !== 'string') {
    return context.json({ error: NOT_A_HASH }, 400)
  }

  const file = await fileIn(context.env, space.id, id)
  if (!file) return context.json({ error: NO_SUCH_FILE }, 404)
  if (file.hash !== base) {
    return context.json({ moved: { hash: file.hash, size: file.size, at: file.updated_at } })
  }

  // Bytes the asker or the space's owner keeps, for the reason `blobSizes` in ops.ts
  // gives.
  const who = context.get('who')
  const asker = who.kind === 'user' ? who.user.id : space.user_id
  const blob = await context.env.DB.prepare(
    'select max(size) as size from blobs where hash = ? and user_id in (?, ?)',
  )
    .bind(hash, asker, space.user_id)
    .first<{ size: number | null }>()
  if (blob?.size === null || blob?.size === undefined)
    return context.json({ error: NO_SUCH_FILE }, 404)

  const device = await deviceOf(context)
  if (file.deleted) await revive(context.env, space.id, device, id)

  const seq = await nextSeq(context.env, space.id)
  const written = await context.env.DB.prepare(
    `update notes set hash = ?, size = ?, seq = ?, doc_seq = ?, doc_by = ?, updated_by = ?,
                      version = version + 1, updated_at = ?
      where id = ? and hash = ?`,
  )
    .bind(hash, blob.size, seq, seq, device, device, now(), id, base)
    .run()
  if (!written.meta.changes) {
    const current = await fileIn(context.env, space.id, id)
    return context.json({
      moved: { hash: current?.hash ?? '', size: current?.size ?? 0, at: current?.updated_at ?? 0 },
    })
  }

  await pokeSpace(context.env, laterOf(context), space.id, seq, device)
  return context.json({ ok: true, seq })
})
