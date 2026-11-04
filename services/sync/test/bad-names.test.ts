/** A name a device refuses never reaches the feed from a new write, and one an account
 *  already holds does not stop anybody's: `feedPageOf` throws the whole page away for
 *  one item it cannot read, and every device of every member stops at that page. */

import { afterEach, beforeEach, expect, test } from 'vitest'
import { feedPageOf, GONE_NAME, isName, type FeedItem } from '@orden/sync-core'
import { sha256 } from '../src/crypto'
import { call, type RpcView, signIn, type TestEnv, testEnv } from './harness'

let env: TestEnv
let token: string
let space: string
let nib: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'rooms@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Rooms' } })).json.space.id
  nib = (await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
})

afterEach(() => env.close())

const LONG = `${'x'.repeat(300)}.md`

async function tool(name: string, args: Record<string, unknown>): Promise<string> {
  const answer = await call<RpcView>(env, '/mcp', {
    token: nib,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { space: 'Rooms', ...args } },
    },
  })
  return answer.json.result.content[0]?.text ?? JSON.stringify(answer.json)
}

async function feed(): Promise<{ read: { items: FeedItem[] } | null; raw: FeedItem[] }> {
  const answer = await call(env, `/v2/spaces/${space}/feed?since=0`, { token })
  return { read: feedPageOf(answer.json), raw: (answer.json as { items: FeedItem[] }).items }
}

async function baseFile(path: string, text: string) {
  const hash = await sha256(text)
  await env.NOTES.put(`blobs/${hash}`, text)
  await env.DB.prepare(
    `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind,
                        name, name_key)
     values (?, ?, ?, 900, 1, 1, 0, ?, ?, 'file', ?, ?)`,
  )
    .bind(crypto.randomUUID(), space, path, text.length, hash, path, path.toLowerCase())
    .run()
}

/** A row from before the account refused such a name. */
function badRow(table: 'notes' | 'folders', id: string, name: string, deleted = 0) {
  return table === 'notes'
    ? env.DB.prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash,
                            kind, name, name_key)
         values (?, ?, ?, 901, 1, 1, ?, 0, '', 'note', ?, ?)`,
      )
        .bind(id, space, name, deleted, name, name)
        .run()
    : env.DB.prepare(
        `insert into folders (id, space_id, parent_id, name, name_key, seq, deleted, updated_at)
         values (?, ?, null, ?, ?, 902, ?, 1)`,
      )
        .bind(id, space, name, name, deleted)
        .run()
}

test('a name no disk holds is refused by every way in', async () => {
  expect(await tool('write_note', { path: LONG, content: 'hello' })).toBe(
    'That is not a note path.',
  )
  const posted = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: LONG, content: 'v1' },
  })
  expect(posted.status).toBe(400)

  const made = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'ok.md', content: 'v1' },
  })
  const renamed = await call(env, `/v1/notes/${made.json.note.id}`, {
    token,
    method: 'PUT',
    body: { baseVersion: made.json.note.version, path: LONG, content: 'v1' },
  })
  expect(renamed.status).toBe(400)

  const { read, raw } = await feed()
  expect(raw.every((one) => isName(one.name))).toBe(true)
  expect(read?.items.map((one) => one.name)).toContain('ok.md')
})

test('a folder of a base cannot name its way out of the space', async () => {
  await baseFile(
    'T.base',
    'filters:\n  and:\n    - file.inFolder("../../Other")\nviews:\n  - type: table\n    name: V\n',
  )
  const said = await tool('add_row', { base: 'T.base', title: 'pwn' })
  expect(said).toContain('not a note path')
  const { read, raw } = await feed()
  expect(raw.every((one) => isName(one.name))).toBe(true)
  expect(read).not.toBeNull()
})

test('a page holding names from before reads, and the cursor gets past them', async () => {
  const good = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'good.md', content: 'words' },
  })
  await badRow('notes', 'a'.repeat(32), LONG)
  await badRow('folders', 'b'.repeat(32), '..')

  const { read, raw } = await feed()
  expect(read).not.toBeNull()
  expect(raw.map((one) => one.name)).toEqual(['good.md'])
  const page = await call(env, `/v2/spaces/${space}/feed?since=0`, { token })
  expect((page.json as { cursor: number }).cursor).toBe(902)
  expect(good.status).toBe(201)
})

test('the delete of such a name is still told, under a name every device reads', async () => {
  await badRow('notes', 'c'.repeat(32), LONG, 1)
  const { read, raw } = await feed()
  expect(raw).toHaveLength(1)
  expect(raw[0]).toMatchObject({ id: 'c'.repeat(32), name: GONE_NAME, deleted: true })
  expect(read?.items).toHaveLength(1)
})

test('a note that already has such a name can still be read, and a save of it still lands', async () => {
  const id = 'd'.repeat(32)
  await badRow('notes', id, LONG)
  expect(await tool('read_note', { path: LONG })).not.toContain('not a note path')

  const held = await call(env, `/v1/notes/${id}`, { token })
  const saved = await call(env, `/v1/notes/${id}`, {
    token,
    method: 'PUT',
    body: { baseVersion: held.json.note.version, path: LONG, content: 'again' },
  })
  expect(saved.status).toBe(200)
})
