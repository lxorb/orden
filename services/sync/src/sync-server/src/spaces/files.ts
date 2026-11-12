import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { listIn, objectBody } from '../body'
import { askInChunks, places } from '../bound'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'

const MOST = 200

const HASH = /^[a-f0-9]{64}$/

const KEPT = /\.pdf$/i
const DRESSING = new Set(['publish.css', 'publish.js'])

export interface SpaceFile {
  path: string
  hash: string
}

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
    if (!staysInside(path)) return 'a file sits inside its own space'
    if (!KEPT.test(path) && !DRESSING.has(path.toLowerCase())) {
      return 'only PDFs, publish.css and publish.js are kept beside the notes'
    }
  }

  return null
}

export function readSpaceFiles(raw: string): SpaceFile[] {
  const held = listIn(raw)
  if (!held) return []

  return held
    .filter((one): one is SpaceFile => wrong([one]) === null)
    .map((one) => ({ path: one.path, hash: one.hash.toLowerCase() }))
    .slice(0, MOST)
}

async function heldBy(env: Env, userId: string, hashes: readonly string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set<string>()

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

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.files
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const stated = (sent as SpaceFile[]).map(({ path, hash }) => ({
    path,
    hash: hash.toLowerCase(),
  }))

  const asked =
    space.role === 'owner' ? stated : stated.filter((one) => !DRESSING.has(one.path.toLowerCase()))

  const already = readSpaceFiles(space.files)
  const serving = new Set(already.map((one) => one.hash))
  const hashes = [...new Set([...asked, ...already].map((one) => one.hash))]
  const held =
    who.kind === 'user' ? await heldBy(context.env, who.user.id, hashes) : new Set<string>()

  const there = (one: SpaceFile) => held.has(one.hash) || serving.has(one.hash)
  const kept = asked.filter(there)
  const missing = [...new Set(asked.filter((one) => !there(one)).map((one) => one.hash))]

  const named = new Set(kept.map((one) => one.path))
  const others = already.filter((one) => !held.has(one.hash) && !named.has(one.path))

  const files = [...kept, ...others]
  const written = JSON.stringify(files)
  if (!fits(written, 'files')) {
    return context.json({ error: 'that is more files than a space keeps' }, 413)
  }

  await writeColumn(context.env, 'files', space.id, written)

  return context.json({ files, missing })
})
