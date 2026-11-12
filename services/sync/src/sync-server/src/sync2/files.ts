import { DIAGRAM_NAMED } from '@orden/markdown/diagrams'
import { Hono } from 'hono'
import { now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { atNextSeq, changesBy, placedOn, TAKEN_SEQ } from '../notes'
import { OUT_OF_SPACE } from '../refused'
import { atLeast, spaceOf } from '../spaces/space'
import { fits, fitsSql } from '../storage'
import type { Env, Note, Variables } from '../types'
import { deviceOf } from './device'
import { blobSizes, revive } from './ops'

interface App {
  Bindings: Env
  Variables: Variables
}

const HASH = /^[a-f0-9]{64}$/

const ONE_REQUEST = 64 * 1024 * 1024

const PART = 8 * 1024 * 1024

const LARGEST = 1024 * 1024 * 1024

export const NO_SUCH_FILE = 'no such file'

export const WRONG_BYTES = 'those bytes are not that hash'
const NOT_A_HASH = 'that is not a hash'
const TOO_BIG = 'that file is too big'

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

export function blobKey(hash: string): string {
  return `blobs/${hash}`
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashOfBytes(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

const NAMED = new TextEncoder().encode(DIAGRAM_NAMED)

export function spellsADiagramName(bytes: ArrayBuffer): boolean {
  const start = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, NAMED.length))
  return start.length === NAMED.length && start.every((byte, at) => byte === NAMED[at])
}

type DigestStreaming = new (algorithm: string) => WritableStream & { digest: Promise<ArrayBuffer> }

async function hashOf(object: R2ObjectBody): Promise<string> {
  const Streaming = (crypto as unknown as { DigestStream?: DigestStreaming }).DigestStream
  if (Streaming) {
    const stream = new Streaming('SHA-256')
    await object.body.pipeTo(stream)
    return hex(await stream.digest)
  }
  return hex(await crypto.subtle.digest('SHA-256', await object.arrayBuffer()))
}

async function stagedSpellsADiagramName(env: Env, upload: Upload): Promise<boolean> {
  if (upload.size > ONE_REQUEST) return false
  const staged = await env.NOTES.get(upload.staging)
  return staged !== null && spellsADiagramName(await staged.arrayBuffer())
}

type FixedLength = new (length: number) => TransformStream<Uint8Array, Uint8Array>

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

async function keepBlob(
  env: Env,
  user: string,
  hash: string,
  size: number,
  type: string,
): Promise<boolean> {
  const written = await env.DB.prepare(
    `insert into blobs (hash, user_id, size, type, created_at)
     select ?1, ?2, ?3, ?4, ?5 where ${fitsSql('?2', '?3')}
     on conflict(hash, user_id) do nothing`,
  )
    .bind(hash, user, size, type, now())
    .run()
  if (written.meta.changes) return true

  const { mine, there } = await held(env, user, hash)
  if (mine) return true
  if (!there) await env.NOTES.delete(blobKey(hash))
  return false
}

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

export async function holdsItsName(env: Env, hash: string, size: number): Promise<boolean> {
  const object = await env.NOTES.get(blobKey(hash))
  if (!object) return false
  if (object.size !== size) return false
  return (await hashOf(object)) === hash
}

const MISNAMED_PAGE = 100
const MISNAMED_AT_MOST = 1000

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
  if ((await hashOfBytes(body)) !== hash || spellsADiagramName(body)) {
    return context.json({ error: WRONG_BYTES }, 400)
  }
  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const type = typeOf(context.req.header('content-type'))
  if (!there || !(await holdsItsName(context.env, hash, body.byteLength))) {
    await context.env.NOTES.put(blobKey(hash), body, { httpMetadata: { contentType: type } })
  }
  if (!(await keepBlob(context.env, user.id, hash, body.byteLength, type))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }
  return context.json({ hash, stored: true }, 201)
})

const UPLOADS = 'upload'
const A_DAY = 24 * 60 * 60 * 1000

interface Upload {
  user: string
  hash: string
  size: number
  type: string
  staging: string
}

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

const MOST_ASKED = 90

v2Blobs.post('/have', async (context) => {
  const user = context.get('user')
  const body: unknown = await context.req.json().catch(() => null)
  const hashes =
    typeof body === 'object' && body !== null ? (body as { hashes?: unknown }).hashes : null
  if (
    !Array.isArray(hashes) ||
    hashes.length > MOST_ASKED ||
    !hashes.every((one): one is string => typeof one === 'string' && HASH.test(one))
  ) {
    return context.json({ error: NOT_A_HASH }, 400)
  }
  if (!hashes.length) return context.json({ kept: [] })
  const { results } = await context.env.DB.prepare(
    `select distinct hash from blobs where user_id = ? and hash in (${hashes.map(() => '?').join(', ')})`,
  )
    .bind(user.id, ...hashes)
    .all<{ hash: string }>()
  return context.json({ kept: results.map((one) => one.hash) })
})

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

function isPartNumber(part: unknown): part is number {
  return typeof part === 'number' && Number.isSafeInteger(part) && part >= 1 && part <= 10_000
}

function r2Code(error: unknown): number | null {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  if (typeof code === 'number') return code
  const said = typeof message === 'string' ? /\((\d+)\)$/.exec(message) : null
  return said?.[1] ? Number(said[1]) : null
}

function isTheListsFault(error: unknown): boolean {
  const code = r2Code(error)
  return code === 10011 || code === 10025 || code === 10048
}

function isUploadGone(error: unknown): boolean {
  return r2Code(error) === 10024
}

async function forgetUpload(env: Env, id: string): Promise<void> {
  await env.DB.prepare('delete from cached where scope = ? and key = ?').bind(UPLOADS, id).run()
}

v2Blobs.put('/parts/:upload/:part', async (context) => {
  const user = context.get('user')
  const upload = await uploadOf(context.env, context.req.param('upload'), user.id)
  if (!upload) return context.json({ error: NO_SUCH_FILE }, 404)

  const part = Number(context.req.param('part'))
  if (!isPartNumber(part)) return context.json({ error: TOO_BIG }, 413)
  const body = await context.req.arrayBuffer()
  if (body.byteLength > PART) return context.json({ error: TOO_BIG }, 413)

  const uploading = context.env.NOTES.resumeMultipartUpload(
    upload.staging,
    context.req.param('upload'),
  )
  try {
    const uploaded = await uploading.uploadPart(part, body)
    return context.json({ part: uploaded.partNumber, etag: uploaded.etag })
  } catch (error) {
    if (isUploadGone(error)) {
      await forgetUpload(context.env, context.req.param('upload'))
      return context.json({ error: NO_SUCH_FILE }, 404)
    }
    throw error
  }
})

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
    if (!isPartNumber(part) || typeof etag !== 'string')
      return context.json({ error: WRONG_BYTES }, 400)
    parts.push({ partNumber: part, etag })
  }

  try {
    await context.env.NOTES.resumeMultipartUpload(upload.staging, id).complete(parts)
  } catch (error) {
    if (isUploadGone(error)) {
      await forgetUpload(context.env, id)
      return context.json({ error: NO_SUCH_FILE }, 404)
    }
    if (isTheListsFault(error)) return context.json({ error: WRONG_BYTES }, 400)
    throw error
  }
  await context.env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind(UPLOADS, id)
    .run()

  const staged = await context.env.NOTES.get(upload.staging)
  const right =
    staged !== null &&
    staged.size === upload.size &&
    (await hashOf(staged)) === upload.hash &&
    !(await stagedSpellsADiagramName(context.env, upload))
  if (!right) {
    await context.env.NOTES.delete(upload.staging)
    return context.json({ error: WRONG_BYTES }, 400)
  }

  const mine = (await held(context.env, user.id, upload.hash)).mine
  if (!mine && !(await fits(context.env, user.id, upload.size))) {
    await context.env.NOTES.delete(upload.staging)
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  if (
    !(await held(context.env, user.id, upload.hash)).there ||
    !(await holdsItsName(context.env, upload.hash, upload.size))
  ) {
    await moveInto(context.env, upload.staging, blobKey(upload.hash), upload.type)
  }
  await context.env.NOTES.delete(upload.staging)
  if (!(await keepBlob(context.env, user.id, upload.hash, upload.size, upload.type))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }
  return context.json({ hash: upload.hash, stored: true }, 201)
})

export const v2Files = new Hono<App>()

async function fileIn(env: Env, spaceId: string, id: string): Promise<Note | null> {
  return await env.DB.prepare("select * from notes where id = ? and space_id = ? and kind = 'file'")
    .bind(id, spaceId)
    .first<Note>()
}

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
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${file.hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})

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
  if (!file || (file.deleted && file.deleted_at === null)) {
    return context.json({ error: NO_SUCH_FILE }, 404)
  }
  if (file.hash !== base) {
    return context.json({ moved: { hash: file.hash, size: file.size, at: file.updated_at } })
  }

  const who = context.get('who')
  const size = (
    await blobSizes(context.env, space, who.kind === 'user' ? who.user.id : null, [hash])
  ).get(hash)
  if (size === undefined) return context.json({ error: NO_SUCH_FILE }, 404)

  const device = await deviceOf(context)
  if (file.deleted) await revive(context.env, space.id, device, id)

  const { seq, changes } = await atNextSeq(
    context.env,
    space.id,
    context.env.DB.prepare(
      `update notes set hash = ?2, size = ?3, seq = ${TAKEN_SEQ}, doc_seq = ${TAKEN_SEQ},
                        doc_by = ?4, updated_by = ?4, version = version + 1, updated_at = ?5,
                        ${changesBy('?4')}, ${placedOn('1')}
        where id = ?6 and hash = ?7`,
    ).bind(space.id, hash, size, device, now(), id, base),
  )
  if (!changes) {
    const current = await fileIn(context.env, space.id, id)
    return context.json({
      moved: { hash: current?.hash ?? '', size: current?.size ?? 0, at: current?.updated_at ?? 0 },
    })
  }

  await pokeSpace(context.env, laterOf(context), space.id, seq, device)
  return context.json({ ok: true, seq })
})
