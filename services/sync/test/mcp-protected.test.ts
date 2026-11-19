import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'
import { type PullResponse } from '@orden/sync-core'
import { framed } from './sync2'

let env: TestEnv
let token: string
let key: string
let home: string

async function note(path: string, content: string) {
  await call(env, `/v1/spaces/${home}/notes`, { token, body: { path, content } })
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const response = await call<RpcView>(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  return response.json.result.content[0]?.text ?? ''
}

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  home = (await call(env, '/v1/spaces', { token, body: { name: 'Home' } })).json.space.id
  await note('Diary/Today.md', '# Today\n- [ ] Call her\nthe secret words\n')
  await note('Plans.md', '# Plans\n- [ ] Ship it\nsee [[Today]] and the secret words\n')
  await call(env, `/v1/protected/spaces/${home}`, {
    method: 'PUT',
    token,
    body: { protected: { Diary: 'password' } },
  })
  key = (await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token
  await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { hiddenKinds: ['experimental', 'experimental-bases'] },
  })
})

afterEach(() => env.close())

describe('an agent reaching the account', () => {
  test('cannot read what the reader protected', async () => {
    expect(await tool('read_note', { space: 'Home', path: 'Diary/Today.md' })).toContain('is protected')
    expect(await tool('read_note', { space: 'Home', path: 'Plans.md' })).toContain('Ship it')
  })

  test('finds nothing in it, and no task or backlink out of it', async () => {
    const found = await tool('search_notes', { query: 'secret words' })
    expect(found).toContain('Plans.md')
    expect(found).not.toContain('Diary')
    expect(await tool('list_backlinks', { space: 'Home', path: 'Plans.md' })).not.toContain('Diary')
    expect(await tool('list_tasks', { space: 'Home' })).not.toContain('Call her')
  })

  test('cannot write into it', async () => {
    expect(await tool('write_note', { space: 'Home', path: 'Diary/Today.md', content: 'gone' })).toContain(
      'is protected',
    )
  })

  test('cannot write into it by another spelling of its folder', async () => {
    expect(await tool('write_note', { space: 'Home', path: 'diary/Planted.md', content: 'planted' })).toContain(
      'is protected',
    )
    expect(await tool('write_note', { space: 'Home', path: 'DIARY/Planted.md', content: 'planted' })).toContain(
      'is protected',
    )
  })

  test('cannot write into it by spelling it in other letters', async () => {
    for (const path of ['diary/New.md', 'DIARY/Today.md', 'D\u0131ary/New.md']) {
      expect(await tool('write_note', { space: 'Home', path, content: 'planted' })).toContain('is protected')
    }
    expect(await tool('list_notes', { space: 'Home' })).not.toMatch(/New\.md/i)
  })

  test('cannot reach into it through the to-do tools', async () => {
    const before = await tool('read_note', { space: 'Home', path: 'Plans.md' })
    expect(await tool('update_task', { space: 'Home', id: 'abc', done: true })).toContain('There is no todo abc')
    expect(await tool('query_base', { space: 'Home', path: 'Diary/Tasks.base' })).toContain('is protected')
    expect(await tool('read_note', { space: 'Home', path: 'Diary/Today.md' })).toContain('is protected')
    expect(await tool('read_note', { space: 'Home', path: 'Plans.md' })).toBe(before)
  })
})

describe('an agent’s token on the routes a token may use', () => {
  const diaryId = () =>
    (env.db.prepare("select id from notes where space_id = ? and path = 'Diary/Today.md'").get(home) as { id: string })
      .id

  test('reads nothing the reader protected, nor its versions', async () => {
    const id = diaryId()
    for (const path of [`/v1/notes/${id}`, `/v1/notes/${id}/versions`]) {
      const answer = await call(env, path, { token: key })
      expect(answer.status, path).toBe(404)
      expect(answer.text).not.toContain('secret words')
    }
    expect((await call(env, `/v1/notes/${id}`, { token })).text).toContain('secret words')
  })

  test('is told of no change in it', async () => {
    const answer = await call<{ notes: { path: string }[] }>(env, `/v1/spaces/${home}/changes?since=0`, { token: key })
    const paths = answer.json.notes.map((one) => one.path)
    expect(paths).toContain('Plans.md')
    expect(paths).not.toContain('Diary/Today.md')
  })

  test('writes nothing into it, nor moves a note in', async () => {
    const id = diaryId()
    const saved = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token: key,
      body: { path: 'Diary/Today.md', content: 'gone' },
    })
    expect(saved.status).toBe(404)

    const made = await call(env, `/v1/spaces/${home}/notes`, {
      token: key,
      body: { path: 'Diary/New.md', content: 'planted' },
    })
    expect(made.status).toBe(403)

    const plans = (env.db.prepare("select id from notes where path = 'Plans.md'").get() as { id: string }).id
    const moved = await call(env, `/v1/notes/${plans}`, {
      method: 'PUT',
      token: key,
      body: { path: 'Diary/Plans.md', content: 'moved' },
    })
    expect(moved.status).toBe(403)
    expect((await call(env, `/v1/notes/${id}`, { token })).text).toContain('secret words')
  })

  test('reaches none of it by another case or spelling of its path', async () => {
    await call(env, `/v2/spaces/${home}/prepare`, { token, method: 'POST' })
    for (const path of ['diary/today.md', 'DIARY/Today.md']) {
      const made = await call(env, `/v1/spaces/${home}/notes`, {
        token: key,
        body: { path, content: 'planted' },
      })
      expect(made.status, path).toBe(403)
      expect(made.text).not.toContain('secret words')
    }
    const into = await call(env, `/v1/spaces/${home}/notes`, {
      token: key,
      body: { path: 'diary/New.md', content: 'planted' },
    })
    expect(into.status).toBe(403)

    const plans = (env.db.prepare("select id from notes where path = 'Plans.md'").get() as { id: string }).id
    const moved = await call(env, `/v1/notes/${plans}`, {
      method: 'PUT',
      token: key,
      body: { path: 'diary/Plans.md', content: 'moved' },
    })
    expect(moved.status).toBe(403)
    expect(await tool('write_note', { path: 'diary/Other.md', content: 'planted' })).not.toMatch(/^(Wrote|Made|Saved)/)
    const paths = (env.db.prepare('select path from notes where deleted = 0').all() as { path: string }[]).map(
      (one) => one.path,
    )
    expect(paths.filter((one) => one.toLowerCase().startsWith('diary/'))).toEqual(['Diary/Today.md'])
  })

  test('turns none of it back', async () => {
    const id = diaryId()
    env.db.exec('update note_versions set at = at - 360000')
    await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'the newer words', baseVersion: 1 },
    })
    const at = Date.now() - 60 * 1000

    const dry = await call<{ paths: string[] }>(env, `/v1/spaces/${home}/rollback`, {
      token: key,
      body: { at, dry: true },
    })
    expect(dry.json.paths).not.toContain('Diary/Today.md')

    const done = await call<{ partial: boolean }>(env, `/v1/spaces/${home}/rollback`, {
      token: key,
      body: { at },
    })
    expect(done.json.partial).toBe(false)
    expect((await call(env, `/v1/notes/${id}`, { token })).text).toContain('the newer words')
  })

  test('turns back what comes after more protected notes than one rollback takes', async () => {
    const at = Date.now() - 60 * 1000
    const insert = env.db.prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
       values (?, ?, ?, ?, 1, ?, 0, 4, 'now')`,
    )
    const version = env.db.prepare(
      "insert into note_versions (note_id, at, hash, size, by) values (?, ?, 'then', 4, '')",
    )
    for (let made = 0; made <= 400; made++) {
      const id = crypto.randomUUID()
      insert.run(id, home, `Diary/${String(made).padStart(3, '0')}.md`, 100 + made, Date.now())
      version.run(id, at - 1000)
    }
    const later = crypto.randomUUID()
    insert.run(later, home, 'Later.md', 600, Date.now())
    version.run(later, at - 1000)

    const dry = await call<{ paths: string[] }>(env, `/v1/spaces/${home}/rollback`, {
      token: key,
      body: { at, dry: true },
    })
    expect(dry.json.paths).toEqual(['Later.md'])
  })

  test('pulls no document of it on sync v2', async () => {
    await call(env, `/v2/spaces/${home}/prepare`, { token, method: 'POST' })
    const asked = { docs: [{ id: diaryId(), epoch: 1, sv: new Uint8Array([0]) }] }

    const pulled = await framed<PullResponse>(env, '/v2/docs/pull', key, asked)
    expect(pulled.value.docs[0]).toMatchObject({ refused: 'gone' })

    const mine = await framed<PullResponse>(env, '/v2/docs/pull', token, asked)
    expect(mine.value.docs[0]).not.toHaveProperty('refused')
  })
})
