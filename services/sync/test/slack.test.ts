import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'

let env: TestEnv
let asked: URLSearchParams[] = []
let logged: unknown[] = []

const TOKEN = 'xoxp-1111-2222-3333-secret'
const STATE = '51234.abcdefghijklmnopqrstuvwx'

beforeEach(() => {
  env = testEnv({ SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'shh-client-secret' })
  asked = []
  logged = []
  for (const level of ['log', 'warn', 'error', 'info'] as const)
    vi.spyOn(console, level).mockImplementation((...said: unknown[]) => void logged.push(said))
  vi.stubGlobal('fetch', async (url: string, options: { body: string }) => {
    expect(url).toBe('https://slack.com/api/oauth.v2.access')
    const form = new URLSearchParams(options.body)
    asked.push(form)
    if (form.get('code') !== 'good-code-1234')
      return Response.json({ ok: false, error: 'invalid_code' })
    return Response.json({
      ok: true,
      app_id: 'A1',
      authed_user: { id: 'U42', scope: 'chat:write', access_token: TOKEN, token_type: 'user' },
      team: { id: 'T9', name: 'Acme' },
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  env.close()
})

describe('the Slack callback', () => {
  test('hands the code back to the loopback port the state names, without keeping it', async () => {
    const answer = await call(env, `/v1/slack/callback?code=good-code-1234&state=${STATE}`)
    expect(answer.status).toBe(302)
    const back = new URL(answer.headers.get('location') ?? '')
    expect(back.origin).toBe('http://127.0.0.1:51234')
    expect(back.searchParams.get('code')).toBe('good-code-1234')
    expect(back.searchParams.get('state')).toBe(STATE)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(asked).toHaveLength(0)
  })

  test('passes a refusal on, and sends nowhere a state Orden did not make', async () => {
    const refused = await call(env, `/v1/slack/callback?error=access_denied&state=${STATE}`)
    expect(new URL(refused.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'access_denied',
    )
    for (const state of [
      'evil.com.abcdefghijklmnopqrstuvwx',
      '80.abcdefghijklmnopqrstuvwx',
      '99999.abcdefghijklmnopqrstuvwx',
      '51234.short',
      '',
    ]) {
      const answer = await call(
        env,
        `/v1/slack/callback?code=good-code-1234&state=${encodeURIComponent(state)}`,
      )
      expect(answer.status).toBe(400)
      expect(answer.headers.get('location')).toBeNull()
    }
  })

  test('needs no sign-in to Orden, since the browser comes from Slack', async () => {
    const answer = await call(env, `/v1/slack/callback?code=good-code-1234&state=${STATE}`)
    expect(answer.status).not.toBe(401)
  })
})

describe('the Slack token exchange', () => {
  test('trades the code with the client secret and hands the user token over once', async () => {
    const answer = await call<{ token: string; user: string; team: string }>(
      env,
      '/v1/slack/token',
      { body: { code: 'good-code-1234' } },
    )
    expect(answer.status).toBe(200)
    expect(answer.json).toMatchObject({ token: TOKEN, user: 'U42', team: 'T9' })
    expect(answer.headers.get('cache-control')).toBe('no-store')
    const form = asked[0]
    expect(form?.get('client_id')).toBe('123.456')
    expect(form?.get('client_secret')).toBe('shh-client-secret')
    expect(form?.get('redirect_uri')).toBe('https://orden.so/v1/slack/callback')
    const rows = env.db
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as { name: string }[]
    for (const { name } of rows) {
      const dumped = JSON.stringify(env.db.prepare(`select * from "${name}"`).all())
      expect(dumped).not.toContain(TOKEN)
      expect(dumped).not.toContain('good-code-1234')
    }
    expect(JSON.stringify(logged)).not.toContain(TOKEN)
  })

  test('says what Slack refused, and never the secret', async () => {
    const answer = await call<{ error: string }>(env, '/v1/slack/token', {
      body: { code: 'used-code-1234' },
    })
    expect(answer.status).toBe(400)
    expect(answer.json.error).toBe('invalid_code')
    expect(answer.text).not.toContain('shh-client-secret')
    expect((await call(env, '/v1/slack/token', { body: { code: '<bad>' } })).status).toBe(400)
    expect((await call(env, '/v1/slack/token', { body: {} })).status).toBe(400)
  })

  test('is off until the client is set, and is rate limited per machine', async () => {
    const bare = testEnv()
    try {
      const off = await call(bare, '/v1/slack/token', { body: { code: 'good-code-1234' } })
      expect(off.status).toBe(503)
    } finally {
      bare.close()
    }
    const headers = { 'cf-connecting-ip': '203.0.113.9' }
    const statuses: number[] = []
    for (let tries = 0; tries < 31; tries++)
      statuses.push(
        (await call(env, '/v1/slack/token', { body: { code: 'good-code-1234' }, headers })).status,
      )
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  test('answers the desktop app across origins', async () => {
    const answer = await call(env, '/v1/slack/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(answer.headers.get('access-control-allow-origin')).toBe('tauri://localhost')
  })
})
