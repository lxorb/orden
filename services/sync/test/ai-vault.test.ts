import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { hubs } from './hub-fakes'

interface Read {
  rev: number
  contents: string | null
}
const CONTENTS = JSON.stringify({ accounts: { accounts: [] }, keys: { anthropic: 'sk-ant-secret' }, seen: {} })
describe('the AI accounts of an account', () => {
  let env: TestEnv
  let running: ReturnType<typeof hubs>
  let token: string
  beforeEach(async () => {
    env = testEnv({ OPENAI_KEY_SECRET: 'a secret for the tests' })
    running = hubs(env)
    env.HUB = running.HUB
    token = await signIn(env, 'vault@example.com')
  })
  afterEach(() => {
    env.close()
  })
  const read = (as = token) => call<Read>(env, '/v2/ai/accounts', { token: as })
  const write = (rev: number, contents: string, as = token) =>
    call<{ rev: number; error?: string }>(env, '/v2/ai/accounts', {
      token: as,
      method: 'PUT',
      body: { rev, contents },
    })
  test('are empty for an account that never kept any', async () => {
    const said = await read()
    expect(said.status).toBe(200)
    expect(said.json).toEqual({ rev: 0, contents: null })
  })
  test('reach every device signed in to the account, with no other device asked', async () => {
    expect((await write(0, CONTENTS)).json.rev).toBe(1)
    const phone = await signIn(env, 'vault@example.com')
    expect((await read(phone)).json).toEqual({ rev: 1, contents: CONTENTS })
    expect(running.asked.filter((one) => one.ask === 'ai')).toHaveLength(1)
  })
  test('are kept sealed, never in the clear', async () => {
    await write(0, CONTENTS)
    const row = await env.DB.prepare('select sealed from ai_accounts').first<{ sealed: string }>()
    expect(row?.sealed).toBeTruthy()
    expect(row?.sealed).not.toContain('sk-ant-secret')
    expect(atob(row?.sealed.split('.')[2] ?? '')).not.toContain('sk-ant-secret')
  })
  test('take a write only over what it read', async () => {
    await write(0, CONTENTS)
    expect((await write(0, CONTENTS)).status).toBe(409)
    expect((await write(5, CONTENTS)).json).toMatchObject({ error: 'stale', rev: 1 })
    expect((await write(1, '{"keys":{}}')).json.rev).toBe(2)
    expect((await read()).json.contents).toBe('{"keys":{}}')
  })
  test('are no other account’s', async () => {
    await write(0, CONTENTS)
    const other = await signIn(env, 'someone@example.com')
    expect((await read(other)).json).toEqual({ rev: 0, contents: null })
  })
  test('are not kept by a server with no secret to seal them', async () => {
    const bare = testEnv()
    const signed = await signIn(bare, 'vault@example.com')
    expect((await call(bare, '/v2/ai/accounts', { token: signed })).status).toBe(503)
    bare.close()
  })
})
