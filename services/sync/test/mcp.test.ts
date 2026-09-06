import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id

  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'plan.md', content: '# Plan\n\nShip the thing.\n' },
  })
})

afterEach(() => env.close())

/** Issues a connector token, read-only unless told otherwise. */
async function connector(readOnly = true): Promise<string> {
  const made = await call(env, '/v1/mcp/token', { token, body: { readOnly } })
  return made.json.token as string
}

async function rpc(key: string, method: string, params?: Record<string, unknown>) {
  return call(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method, params },
  })
}

async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(key, 'tools/call', { name, arguments: args })
  return response.json?.result?.content?.[0]?.text as string
}

describe('handing out a token', () => {
  test('gives one back exactly once', async () => {
    const made = await call(env, '/v1/mcp/token', { token, body: { readOnly: true } })

    expect(made.status).toBe(200)
    expect(made.json.token).toMatch(/^nib_/)

    // Asking again says one exists, but never repeats the secret.
    const asked = await call(env, '/v1/mcp/token', { token })
    expect(asked.json.exists).toBe(true)
    expect(asked.json.token).toBeUndefined()
  })

  test('replaces the previous one', async () => {
    const first = await connector()
    const second = await connector()

    expect(first).not.toBe(second)
    expect((await rpc(first, 'tools/list')).status).toBe(401)
    expect((await rpc(second, 'tools/list')).status).toBe(200)
  })

  test('can be taken back', async () => {
    const key = await connector()
    await call(env, '/v1/mcp/token', { token, method: 'DELETE' })

    expect((await rpc(key, 'tools/list')).status).toBe(401)
  })

  test('needs a session to ask for', async () => {
    expect((await call(env, '/v1/mcp/token', { body: {} })).status).toBe(401)
  })
})

describe('the connector', () => {
  test('refuses a caller with no token', async () => {
    expect(
      (await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status,
    ).toBe(401)
  })

  test('refuses a token that was never issued', async () => {
    expect((await rpc('nib_madeup', 'ping')).status).toBe(401)
  })

  test('introduces itself', async () => {
    const response = await rpc(await connector(), 'initialize')

    expect(response.json.result.serverInfo.name).toBe('nib')
    expect(response.json.result.capabilities.tools).toBeDefined()
  })

  test('lists its tools', async () => {
    const response = await rpc(await connector(), 'tools/list')
    const names = response.json.result.tools.map((entry: { name: string }) => entry.name)

    expect(names).toContain('list_spaces')
    expect(names).toContain('read_note')
    expect(names).toContain('write_note')
  })

  test('answers a notification with no body', async () => {
    const response = await rpc(await connector(), 'notifications/initialized')
    expect(response.status).toBe(202)
  })

  test('says so for a method it does not have', async () => {
    const response = await rpc(await connector(), 'tools/nonsense')
    expect(response.json.error.code).toBe(-32601)
  })
})

describe('reading notes through it', () => {
  test('lists the spaces', async () => {
    expect(await tool(await connector(), 'list_spaces')).toContain('Work')
  })

  test('lists the notes in one', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Work' })).toContain('plan.md')
  })

  test('takes a space id as readily as a name', async () => {
    expect(await tool(await connector(), 'list_notes', { space })).toContain('plan.md')
  })

  test('reads a note', async () => {
    expect(
      await tool(await connector(), 'read_note', { space: 'Work', path: 'plan.md' }),
    ).toContain('Ship the thing.')
  })

  test('searches across the account', async () => {
    expect(await tool(await connector(), 'search_notes', { query: 'ship' })).toContain('plan.md')
  })

  test('says plainly when a space is not there', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Nowhere' })).toContain('No space')
  })

  test('refuses a path that climbs out of the space', async () => {
    const text = await tool(await connector(), 'read_note', {
      space: 'Work',
      path: '../../etc/passwd',
    })
    expect(text).toContain('not a note path')
  })
})

describe('writing through it', () => {
  test('is refused while the token is read-only', async () => {
    const text = await tool(await connector(true), 'write_note', {
      space: 'Work',
      path: 'new.md',
      content: 'hello',
    })

    expect(text).toContain('only read')
  })

  test('creates a note when the token allows it', async () => {
    const key = await connector(false)
    expect(
      await tool(key, 'write_note', { space: 'Work', path: 'new.md', content: 'hello' }),
    ).toContain('Saved')

    expect(await tool(key, 'read_note', { space: 'Work', path: 'new.md' })).toBe('hello')
  })

  test('replaces one that is already there', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'plan.md', content: 'replaced' })

    expect(await tool(key, 'read_note', { space: 'Work', path: 'plan.md' })).toBe('replaced')
  })

  test('a written note reaches the syncing clients', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'fresh.md', content: 'from the llm' })

    const changes = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    const paths = changes.json.notes.map((note: { path: string }) => note.path)

    expect(paths).toContain('fresh.md')
  })

  test('one account cannot reach another', async () => {
    const otherToken = await signIn(env, 'other@b.dev')
    const otherKey = await call(env, '/v1/mcp/token', {
      token: otherToken,
      body: { readOnly: false },
    })

    expect(await tool(otherKey.json.token, 'list_spaces')).toContain('No spaces')
    expect(
      await tool(otherKey.json.token, 'read_note', { space: 'Work', path: 'plan.md' }),
    ).toContain('No space')
  })
})
