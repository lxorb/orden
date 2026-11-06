import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

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
})

afterEach(() => env.close())

describe('an agent reaching the account', () => {
  test('cannot read what the reader protected', async () => {
    expect(await tool('read_note', { space: 'Home', path: 'Diary/Today.md' })).toContain(
      'is protected',
    )
    expect(await tool('read_note', { space: 'Home', path: 'Plans.md' })).toContain('Ship it')
  })

  test('finds nothing in it, and no task or backlink out of it', async () => {
    const found = await tool('search_notes', { query: 'secret words' })
    expect(found).toContain('Plans.md')
    expect(found).not.toContain('Diary')
    expect(await tool('list_backlinks', { space: 'Home', path: 'Plans.md' })).not.toContain('Diary')
    const tasks = await tool('list_tasks', { space: 'Home' })
    expect(tasks).toContain('Ship it')
    expect(tasks).not.toContain('Call her')
  })

  test('cannot write into it', async () => {
    expect(
      await tool('write_note', { space: 'Home', path: 'Diary/Today.md', content: 'gone' }),
    ).toContain('is protected')
  })
})
