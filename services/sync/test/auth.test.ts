import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.restoreAllMocks()
})

/** Reads the code out of the logging mailer. */
async function requestCode(email: string): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })

  await call(env, '/v1/auth/code', { body: { email } })
  spy.mockRestore()

  const match = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!match) throw new Error('no code sent')
  return match[1] + match[2]
}

describe('requesting a code', () => {
  test('accepts a valid address', async () => {
    const response = await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })
    expect(response.status).toBe(200)
    expect(response.json.ok).toBe(true)
  })

  test('rejects a malformed address', async () => {
    const response = await call(env, '/v1/auth/code', { body: { email: 'not-an-email' } })
    expect(response.status).toBe(400)
  })

  test('does not reveal whether the account exists', async () => {
    const fresh = await call(env, '/v1/auth/code', { body: { email: 'new@b.dev' } })
    await signIn(env, 'known@b.dev')
    const known = await call(env, '/v1/auth/code', { body: { email: 'known@b.dev' } })

    expect(known.status).toBe(fresh.status)
    expect(Object.keys(known.json)).toEqual(Object.keys(fresh.json))
  })

  test('will not send a second code straight away', async () => {
    await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })
    const again = await call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } })

    expect(again.status).toBe(200)
    expect(again.json.resendIn).toBeGreaterThan(0)
  })
})

describe('verifying a code', () => {
  test('creates the account on first use', async () => {
    const code = await requestCode('new@b.dev')
    const response = await call(env, '/v1/auth/verify', { body: { email: 'new@b.dev', code } })

    expect(response.status).toBe(200)
    expect(response.json.user.email).toBe('new@b.dev')
    expect(response.json.token).toMatch(/^[0-9a-f]{64}$/)
  })

  test('signs the same person back in later', async () => {
    const first = await signIn(env, 'a@b.dev')
    const second = await signIn(env, 'a@b.dev')

    expect(first).not.toBe(second)

    const me = await call(env, '/v1/me', { token: second })
    expect(me.json.user.email).toBe('a@b.dev')
  })

  test('rejects the wrong code', async () => {
    await requestCode('a@b.dev')
    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: '000000' },
    })

    expect(response.status).toBe(400)
  })

  test('locks out after five wrong tries', async () => {
    await requestCode('a@b.dev')

    for (let attempt = 0; attempt < 5; attempt++) {
      await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code: '000000' } })
    }

    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'a@b.dev', code: '000000' },
    })
    expect(response.status).toBe(429)
  })

  test('a used code cannot be replayed', async () => {
    const code = await requestCode('a@b.dev')
    await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })

    const replay = await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })
    expect(replay.status).toBe(400)
  })

  test('treats the address case-insensitively', async () => {
    const code = await requestCode('Mixed@B.dev')
    const response = await call(env, '/v1/auth/verify', {
      body: { email: 'mixed@b.dev', code },
    })

    expect(response.status).toBe(200)
    expect(response.json.user.email).toBe('mixed@b.dev')
  })
})

describe('sessions', () => {
  test('a token opens the account', async () => {
    const token = await signIn(env, 'a@b.dev')
    const me = await call(env, '/v1/me', { token })

    expect(me.status).toBe(200)
    expect(me.json.user.email).toBe('a@b.dev')
  })

  test('no token is refused', async () => {
    expect((await call(env, '/v1/me')).status).toBe(401)
  })

  test('a made-up token is refused', async () => {
    expect((await call(env, '/v1/me', { token: 'f'.repeat(64) })).status).toBe(401)
  })

  test('signing out ends the session', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/auth/signout', { method: 'POST', token })

    expect((await call(env, '/v1/me', { token })).status).toBe(401)
  })
})

describe('a display name', () => {
  test('starts empty', async () => {
    const token = await signIn(env, 'a@b.dev')
    const me = await call(env, '/v1/me', { token })
    expect(me.json.user.name).toBeNull()
  })

  test('can be set, and comes back with the account', async () => {
    const token = await signIn(env, 'a@b.dev')
    const set = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: '  Ada   Lovelace ' },
    })

    expect(set.status).toBe(200)
    expect(set.json.user.name).toBe('Ada Lovelace')
    expect((await call(env, '/v1/me', { token })).json.user.name).toBe('Ada Lovelace')
  })

  test('comes back on the next sign-in as well', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })

    const code = await requestCode('a@b.dev')
    const again = await call(env, '/v1/auth/verify', { body: { email: 'a@b.dev', code } })
    expect(again.json.user.name).toBe('Ada')
  })

  test('an empty name clears it', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    const cleared = await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '   ' } })

    expect(cleared.json.user.name).toBeNull()
  })

  test('control characters are dropped from a name', async () => {
    const token = await signIn(env, 'a@b.dev')
    const set = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: 'Ada\u0000 Love\u001blace\u007f' },
    })

    expect(set.status).toBe(200)
    expect(set.json.user.name).toBe('Ada Lovelace')
  })

  test('a name of nothing but control characters clears it', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    const cleared = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: '\u0001\u0002' },
    })

    expect(cleared.json.user.name).toBeNull()
  })

  test('a name longer than sixty characters is refused', async () => {
    const token = await signIn(env, 'a@b.dev')
    const response = await call(env, '/v1/me', {
      method: 'PATCH',
      token,
      body: { name: 'x'.repeat(61) },
    })

    expect(response.status).toBe(400)
  })

  test('needs a session', async () => {
    const response = await call(env, '/v1/me', { method: 'PATCH', body: { name: 'Ada' } })
    expect(response.status).toBe(401)
  })
})
