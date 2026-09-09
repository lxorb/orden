/** The files of a space that are not notes: today the PDFs a note links to.
 *
 *  The bytes go up as blobs, addressed by the hash of their contents, exactly as
 *  a pasted image does. What a space records here is where in it each one sits,
 *  which is what lets a published note linking `[[paper.pdf]]` be served the
 *  paper: the link says a name, and the name has to reach a blob.
 *
 *  The whole list is written at once, the way bookmarks are. It is short, it is
 *  the client's own statement about its space, and one PUT of the lot is what
 *  makes a file that has gone stop being served.
 *
 *  Only a file whose bytes this account is keeping is recorded. The answer says
 *  which hashes were not, so a client knows exactly what to upload and a large
 *  PDF is sent once rather than on every pass. */

import { Hono } from 'hono'
import { askInChunks, places } from '../bound'
import { now } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** More files than a space of notes keeps beside them, and a bound on the one
 *  statement below that grows with what was sent. */
const MOST = 200
/** A path inside a space, which is a few folder names and a file name. */
const LONGEST_PATH = 300
/** What the column may grow to. Every entry is bounded on its own; this is the
 *  other end of the same guard. */
const MOST_BYTES = 32 * 1024

const HASH = /^[a-f0-9]{64}$/

/** What a space may record. A PDF is the one file Nib itself opens, and the one
 *  a published note can point a reader at; anything else beside a note belongs
 *  to that note and is carried inside it. */
const KEPT = /\.pdf$/i

export interface SpaceFile {
  /** Relative to the space, `/`-separated: `reading/paper.pdf`. */
  path: string
  /** The hash of its bytes, which is the blob that holds them. */
  hash: string
}

/** What is wrong with the list that arrived, as one sentence the app can show,
 *  or null when nothing is. */
function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'files must be a list'
  if (value.length > MOST) return `files holds at most ${MOST} entries`

  for (const one of value) {
    if (!one || typeof one !== 'object' || Array.isArray(one)) return 'a file must be an object'

    const { path, hash } = one as Record<string, unknown>
    if (typeof path !== 'string' || !path || path.length > LONGEST_PATH) {
      return `a file's path must be text of at most ${LONGEST_PATH} characters`
    }
    if (typeof hash !== 'string' || !HASH.test(hash.toLowerCase())) {
      return "a file's hash must be the hash of its contents"
    }
    // A path climbing out of the space is not a place in it, and a path the
    // column holds is one a published page turns into a URL.
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      return 'a file sits inside its own space'
    }
    if (!KEPT.test(path)) return 'only PDFs are kept beside the notes'
  }

  return null
}

/** The column, as a published page reads it back. Anything in it that is not a
 *  file is left out: the column is written whole by clients, and a newer one may
 *  keep something this version has never heard of. */
export function readSpaceFiles(raw: string): SpaceFile[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((one): one is SpaceFile => wrong([one]) === null)
    .map((one) => ({ path: one.path, hash: one.hash.toLowerCase() }))
    .slice(0, MOST)
}

/** Which of those hashes this account is actually keeping. */
async function heldBy(env: Env, userId: string, hashes: readonly string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set<string>()

  // A chunk at a time: a space may record two hundred files and D1 binds a
  // hundred parameters; see src/bound.ts.
  const found = await askInChunks(hashes, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select hash from blobs where user_id = ? and hash in (${places(chunk.length)})`,
    )
      .bind(userId, ...chunk)
      .all<{ hash: string }>()

    return results
  })

  return new Set(found.map((row) => row.hash))
}

export const spaceFiles = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceFiles.put('/:id/files', atLeast('write'), async (context) => {
  const who = context.get('who')
  const space = spaceOf(context)

  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  const sent = (body as Record<string, unknown>).files
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the fields that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const asked = (sent as SpaceFile[]).map(({ path, hash }) => ({
    path,
    hash: hash.toLowerCase(),
  }))

  // A row pointing at a blob nobody in this space keeps would serve nothing, so
  // an entry is kept when this account holds its bytes or when the space is
  // already serving them. Both halves matter once a space can be shared: the
  // writer's own PDFs are theirs to add, and the ones somebody else put here
  // are not theirs to drop by sending a list that leaves them out.
  //
  // A guest holds no bytes anywhere, because a guest has no storage to hold
  // them in. So the first half is empty for one, and what stays is what the
  // space was already serving.
  const already = new Set(readSpaceFiles(space.files).map((one) => one.hash))
  const held =
    who.kind === 'user'
      ? await heldBy(
          context.env,
          who.user.id,
          [...new Set(asked.map((one) => one.hash))].slice(0, MOST),
        )
      : new Set<string>()

  const there = (one: SpaceFile) => held.has(one.hash) || already.has(one.hash)
  const kept = asked.filter(there)
  const missing = [...new Set(asked.filter((one) => !there(one)).map((one) => one.hash))]

  const written = JSON.stringify(kept)
  if (new TextEncoder().encode(written).length > MOST_BYTES) {
    return context.json({ error: 'that is more files than a space keeps' }, 413)
  }

  // The space is touched as well, so a device watching for spaces that changed
  // learns that this one did.
  await context.env.DB.prepare('update spaces set files = ?, updated_at = ? where id = ?')
    .bind(written, now(), space.id)
    .run()

  return context.json({ files: kept, missing })
})
