/** What a version of a note shows, as what keeps a picture: an account with more
 *  versions than one sweep reads gets to the end of them over several nights, keeps
 *  every picture a version shows, and is let go of the rest (0068, `versionPictures`). */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sweepUnused } from '../src/unused'
import { keepVersion, keepVersionNow, versionKey } from '../src/versions'
import { call, signIn, type TestEnv, testEnv } from './harness'

let env: TestEnv
let token: string
let space: string
let noteId: string
let owner: string
const BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const HASH = createHash('sha256').update(BYTES).digest('hex')
const SHOWS = `![a](https://orden.so/i/${HASH}.png)\n`

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'M' } })).json.space.id
  const made = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Kept.md', content: 'x\n' },
  })
  noteId = made.json.note.id
  owner = (
    env.db.prepare('select user_id from spaces where id = ?').get(space) as { user_id: string }
  ).user_id
  const up = await call(env, `/v2/blobs/${HASH}`, {
    token,
    method: 'PUT',
    raw: BYTES,
    headers: { 'content-type': 'image/png' },
  })
  expect(up.status).toBe(201)
  env.db
    .prepare('insert into unused_blobs (user_id, hash, since) values (?, ?, 1)')
    .run(owner, HASH)
})

afterEach(() => env.close())

/** Versions from before there was a column: a row, and words in the bucket. */
async function older(many: number, words: (at: number) => string): Promise<void> {
  const row = env.db.prepare(
    'insert into note_versions (note_id, at, hash, size) values (?, ?, ?, 1)',
  )
  for (let at = 0; at < many; at++) {
    const said = words(at)
    const hash = createHash('sha256').update(said).digest('hex')
    await env.NOTES.put(versionKey(hash), said)
    row.run(noteId, 1000 + at, hash)
  }
}

const holds = () =>
  (
    env.db.prepare('select count(*) as many from blobs where hash = ?').get(HASH) as {
      many: number
    }
  ).many
const listed = () =>
  (env.db.prepare('select count(*) as many from unused_blobs').get() as { many: number }).many
const unread = () =>
  (
    env.db.prepare('select count(*) as many from note_versions where pictures is null').get() as {
      many: number
    }
  ).many

describe('a picture let go of by an account with more versions than a sweep reads', () => {
  test('goes once they have all been read, and not before', async () => {
    await older(600, (at) => `version ${String(at)}\n`)

    expect(await sweepUnused(env)).toBe(0)
    expect(holds()).toBe(1)
    expect(listed()).toBe(1)
    const after = unread()
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(600)

    expect(await sweepUnused(env)).toBe(0)
    expect(unread()).toBeLessThan(after)
    expect(holds()).toBe(1)

    expect(await sweepUnused(env)).toBe(1)
    expect(unread()).toBe(0)
    expect(holds()).toBe(0)
    expect(listed()).toBe(0)
  })

  test('stays where the last of them read shows it', async () => {
    await older(600, (at) => (at === 599 ? SHOWS : `version ${String(at)}\n`))

    for (let night = 0; night < 3; night++) await sweepUnused(env)

    expect(unread()).toBe(0)
    expect(holds()).toBe(1)
    expect(listed()).toBe(0)
  })

  test('stays, and the bytes are served, where a version says it in raw HTML', async () => {
    await older(3, (at) => (at === 1 ? `<img src="https://orden.so/i/${HASH}.png">\n` : 'x\n'))

    await sweepUnused(env)

    expect(holds()).toBe(1)
  })
})

describe('a version kept now', () => {
  test('says what it shows, and no sweep reads its body', async () => {
    await keepVersionNow(env, noteId, SHOWS, 'one')
    env.db.prepare('update note_versions set pictures = ? where pictures is null').run('[]')
    await env.NOTES.delete(versionKey(createHash('sha256').update(SHOWS).digest('hex')))

    await sweepUnused(env)

    expect(holds()).toBe(1)
    expect(listed()).toBe(0)
  })

  test('that folds into the one before says what the words it took say', async () => {
    const say = async (content: string) => {
      const hash = createHash('sha256').update(content).digest('hex')
      await keepVersion(env, { id: noteId, hash, size: content.length }, content, 'one', 'dev')
    }
    await say('first\n')
    await say('second\n')
    await say('third\n')
    await say(SHOWS)
    await say('fifth\n')
    await say('sixth\n')

    const rows = env.db
      .prepare('select hash, pictures from note_versions where note_id = ?')
      .all(noteId) as { hash: string; pictures: string | null }[]
    const body = async (hash: string) => (await env.NOTES.get(versionKey(hash)))?.text()
    for (const row of rows) {
      const words = await body(row.hash)
      if (words === undefined) continue
      expect(row.pictures).toBe(words === SHOWS ? JSON.stringify([HASH]) : '[]')
    }
  })
})
