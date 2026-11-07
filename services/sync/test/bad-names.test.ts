import { afterEach, beforeEach, expect, test } from 'vitest'
import { feedPageOf, isName, type FeedItem } from '@orden/sync-core'
import { sha256 } from '../src/crypto'
import { cleanPath, noteBeside } from '../src/notes'
import type { Note } from '../src/types'
import { call, type RpcView, signIn, type TestEnv, testEnv } from './harness'

let env: TestEnv
let token: string
let space: string
let orden: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'rooms@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Rooms' } })).json.space.id
  orden = (await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
})

afterEach(() => env.close())

const LONG = `${'x'.repeat(300)}.md`

async function tool(name: string, args: Record<string, unknown>): Promise<string> {
  const answer = await call<RpcView>(env, '/mcp', {
    token: orden,
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
  return {
    read: feedPageOf(answer.json),
    raw: (answer.json as unknown as { items: FeedItem[] }).items,
  }
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

test('a page holding names from before reads, each under a name a device can hold', async () => {
  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'good.md', content: 'words' },
  })
  await badRow('notes', 'a'.repeat(32), LONG)
  await badRow('folders', 'b'.repeat(32), '..')

  const { read, raw } = await feed()
  expect(read?.items).toHaveLength(3)
  expect(raw.every((one) => isName(one.name))).toBe(true)
  const names = raw.map((one) => one.name)
  expect(names).toContain('good.md')
  expect(names).toContain('__')
  expect(names.find((one) => one.startsWith('xxx'))?.endsWith('.md')).toBe(true)
  const page = await call(env, `/v2/spaces/${space}/feed?since=0`, { token })
  expect((page.json as unknown as { cursor: number }).cursor).toBe(902)
})

test('the delete of such a name is told too', async () => {
  await badRow('notes', 'c'.repeat(32), LONG, 1)
  const { read, raw } = await feed()
  expect(raw).toHaveLength(1)
  expect(raw[0]).toMatchObject({ id: 'c'.repeat(32), deleted: true })
  expect(isName(raw[0]?.name)).toBe(true)
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

test('a copy kept beside a note named near the limit, or under a bad folder, still lands', async () => {
  const near = `${'n'.repeat(250)}.md`
  const made = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: near, content: 'near' },
  })
  const held = await env.DB.prepare('select * from notes where id = ?')
    .bind(made.json.note.id)
    .first<Note>()
  const copy = await noteBeside(env, held!, 'other words')
  expect(cleanPath(copy?.path ?? '')).toBe(copy?.path)
  const second = await noteBeside(env, held!, 'more other words')
  expect(second?.path).not.toBe(copy?.path)
  expect(cleanPath(second?.path ?? '')).toBe(second?.path)

  const lost = await noteBeside(
    env,
    { ...held!, path: '../../Other/pwn.md', id: 'e'.repeat(32) },
    'words under a bad folder',
  )
  expect(lost?.path.startsWith('pwn')).toBe(true)
  expect((await feed()).read).not.toBeNull()
})
