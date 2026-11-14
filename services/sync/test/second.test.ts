import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import worker from '../src'
import { call, mail, signIn, type TestEnv, testEnv } from './harness'
import { sha256 } from '../src/sync-server/src/crypto'
import {
  base32,
  codeAt,
  matches,
  newSecret,
  otpauth,
  RECOVERY_ROUNDS,
  recoveryCodes,
  recoveryCost,
  recoveryHash,
  resealBorrowed,
} from '../src/sync-server-accounts/src/second'
import { opened } from '../src/sync-server/src/ai-key'

async function nightly(env: TestEnv): Promise<void> {
  const waiting: Promise<unknown>[] = []
  const context = {
    waitUntil: (work: Promise<unknown>) => waiting.push(work),
    passThroughOnException: () => undefined,
  }

  worker.scheduled({} as ScheduledEvent, env, context as unknown as ExecutionContext)
  await Promise.all(waiting)
}

interface SecondView {
  on?: boolean
  possible?: boolean
  codesLeft?: number
  holding?: string
  secret?: string
  uri?: string
  recovery?: string[]
  second?: boolean
  token?: string
  error?: string
  sessions?: { id: string; name: string; current: boolean; lastUsedAt: number | null }[]
  ended?: number
  ok?: boolean
}

const KEPT = { OPENAI_KEY_SECRET: 'a secret for the tests' }

describe('what a recovery code costs to hash', () => {
  test('is a hundred thousand rounds, whatever a test asks for', () => {
    expect(RECOVERY_ROUNDS).toBe(100_000)
  })

  test('and nothing a running Worker can reach says otherwise', async () => {
    const module: Record<string, unknown> = await import('../src/sync-server-accounts/src/second')

    expect(Object.keys(module)).not.toContain('costRecoveryLess')
    const setters = Object.entries(module).filter(
      ([name, held]) => typeof held === 'function' && /^(?:set|cost)/i.test(name),
    )
    expect(setters).toEqual([])
  })
})

describe('the codes themselves', () => {
  test('are base32 the way RFC 4648 writes it', () => {
    expect(base32(new TextEncoder().encode('f'))).toBe('MY')
    expect(base32(new TextEncoder().encode('fo'))).toBe('MZXQ')
    expect(base32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
  })

  test('are the six digits the standard names for a known secret', async () => {
    const secret = [...new TextEncoder().encode('12345678901234567890')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    expect(await codeAt(secret, Math.floor(59 / 30))).toBe('287082')
    expect(await codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804')
    expect(await codeAt(secret, Math.floor(1234567890 / 30))).toBe('005924')
  })

  test('match now and one step either side, and nothing further out', async () => {
    const secret = newSecret()
    const at = 1_700_000_000_000

    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000)), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) - 1), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) + 1), at)).toBe(true)
    expect(await matches(secret, await codeAt(secret, Math.floor(at / 30_000) + 4), at)).toBe(false)
    expect(await matches(secret, '000000000', at)).toBe(false)
    expect(await matches(secret, '', at)).toBe(false)
  })

  test('are offered to an app as a URI it knows', () => {
    const uri = otpauth(newSecret(), 'a@b.dev')

    expect(uri.startsWith('otpauth://totp/Orden%3Aa%40b.dev?secret=')).toBe(true)
    expect(uri).toContain('issuer=Orden&')
    expect(uri).toContain('digits=6')
  })

  test('and the recovery codes are ten, and all different', () => {
    const codes = recoveryCodes()

    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes[0]).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/)
  })
})

describe('turning it on', () => {
  let env: TestEnv
  let token: string

  beforeEach(async () => {
    env = testEnv(KEPT)
    token = await signIn(env, 'a@b.dev')
  })

  afterEach(() => env.close())

  test('is off to begin with, and says whether it can be kept', async () => {
    const said = await call<SecondView>(env, '/v1/second', { token })

    expect(said.json.on).toBe(false)
    expect(said.json.possible).toBe(true)
  })

  test('hands out a secret without turning anything on', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })

    expect(begun.json.secret).toMatch(/^[A-Z2-7]+$/)
    expect(begun.json.holding).toBeTruthy()

    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(false)
  })

  test('and turns on once a code proves the app has it', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)

    const done = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.recovery).toHaveLength(10)

    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(true)
    expect(said.json.codesLeft).toBe(10)
  })

  test('refuses a code that is not the app’s', async () => {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const done = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: '000000' },
    })

    expect(done.status).toBe(400)
    expect(done.json.error).toBe('that code is not right')
  })

  test('and offers nothing at all where the service cannot keep a secret', async () => {
    const bare = testEnv()
    const other = await signIn(bare, 'a@b.dev')

    const said = await call<SecondView>(bare, '/v1/second', { token: other })
    expect(said.json.possible).toBe(false)

    const begun = await call<SecondView>(bare, '/v1/second', { token: other, body: {} })
    expect(begun.status).toBe(503)

    bare.close()
  })
})

describe('signing in with it on', () => {
  let env: TestEnv
  let secret: string

  beforeEach(async () => {
    env = testEnv(KEPT)
    const token = await signIn(env, 'a@b.dev')

    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    secret = secretOf(env)
    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })
  })

  afterEach(() => env.close())

  test('the emailed code is half of it', async () => {
    const half = await signInHalfWay(env)

    expect(half.json.second).toBe(true)
    expect(half.json.token).toBeUndefined()
    expect(half.json.holding).toBeTruthy()
  })

  test('and the second code finishes it', async () => {
    const half = await signInHalfWay(env)

    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.token).toBeTruthy()

    const me = await call<SecondView>(env, '/v1/sessions', { token: done.json.token ?? '' })
    expect(me.status).toBe(200)
  })

  test('a recovery code finishes it too, and is spent', async () => {
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    const code = made.json.recovery?.[0] ?? ''

    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code },
    })
    expect(done.json.token).toBeTruthy()

    const again = await signInHalfWay(env)
    const refused = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: again.json.holding, code },
    })
    expect(refused.status).toBe(400)
  })

  test('and a wrong second code is refused', async () => {
    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: '000000' },
    })

    expect(done.status).toBe(400)
    expect(done.json.error).toBe('that code is not right')
  })

  test('a half-finished sign-in cannot be finished twice', async () => {
    const half = await signInHalfWay(env)
    const code = await codeAt(secret, step())

    await call(env, '/v1/auth/second', { body: { holding: half.json.holding, code } })
    const again = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code },
    })

    expect(again.status).toBe(400)
  })

  test('and a code the app has already answered with is spent', async () => {
    const code = await codeAt(secret, step())

    const first = await signInHalfWay(env)
    const got = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: first.json.holding, code },
    })
    expect(got.json.token).toBeTruthy()

    const second = await signInHalfWay(env)
    const again = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: second.json.holding, code },
    })

    expect(again.status).toBe(400)
  })

  test('but a wrong code does not throw the whole sign-in away', async () => {
    const half = await signInHalfWay(env)

    const wrong = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: '000000' },
    })
    expect(wrong.status).toBe(400)

    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step()) },
    })

    expect(done.status).toBe(200)
    expect(done.json.token).toBeTruthy()
  })

  test('and the list a route wrote was hashed at the cost this build hashes at', async () => {
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    const code = made.json.recovery?.[0] ?? ''

    const user = env.db.prepare("select id from users where email = 'a@b.dev'").get() as {
      id: string
    }
    const held = (
      env.db.prepare('select code_hash from recovery_codes').all() as { code_hash: string }[]
    ).map((one) => one.code_hash)

    expect(held).toContain(await recoveryHash(user.id, code, recoveryCost()))
    expect(held).not.toContain(await recoveryHash(user.id, code, recoveryCost() + 1))
  })

  test('and a recovery code is not a bare digest of five bytes at rest', async () => {
    const token = await signInWith(env, secret)
    const made = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })

    const code = made.json.recovery?.[0] ?? ''
    expect(code.replace(/\W/g, '')).toHaveLength(20)

    const held = env.db.prepare('select code_hash from recovery_codes').all() as {
      code_hash: string
    }[]

    expect(held.map((one) => one.code_hash)).not.toContain(await sha256(code))
  })

  test('and turning it off takes a code', async () => {
    const token = await signInWith(env, secret)

    const refused = await call<SecondView>(env, '/v1/second', {
      method: 'DELETE',
      token,
      body: { code: '000000' },
    })
    expect(refused.status).toBe(400)

    const off = await call<SecondView>(env, '/v1/second', {
      method: 'DELETE',
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    expect(off.status).toBe(200)

    const said = await call<SecondView>(env, '/v1/second', { token })
    expect(said.json.on).toBe(false)
  })

  async function replace(token: string, current?: string) {
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const fresh = await secretHeldFor(env, begun.json.holding ?? '')
    const done = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: {
        holding: begun.json.holding,
        code: await codeAt(fresh, step()),
        ...(current === undefined ? {} : { current }),
      },
    })

    return { done, fresh }
  }

  test('and replacing it takes a code from the one it replaces', async () => {
    const token = await signInWith(env, secret)
    const before = env.db.prepare('select totp_secret from users').get()

    for (const current of [undefined, '', '000000']) {
      const { done } = await replace(token, current)
      expect(done.status).toBe(400)
      expect(done.json.error).toBe('that code is not right')
    }

    expect(env.db.prepare('select totp_secret from users').get()).toEqual(before)
    expect((await call<SecondView>(env, '/v1/second', { token })).json.codesLeft).toBe(10)

    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step() + 1) },
    })
    expect(done.status).toBe(200)
  })

  test('which, given, replaces it: the old secret and its list stop working', async () => {
    const token = await signInWith(env, secret)
    const { done, fresh } = await replace(token, await codeAt(secret, step() + 1))
    expect(done.status).toBe(200)
    expect(done.json.recovery).toHaveLength(10)

    const half = await signInHalfWay(env)
    const old = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step() + 1) },
    })
    expect(old.status).toBe(400)

    const now = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(fresh, step()) },
    })
    expect(now.status).toBe(200)
  })

  test('and a recovery code will do for the one it replaces', async () => {
    const token = await signInWith(env, secret)
    const list = await call<SecondView>(env, '/v1/second/recovery', {
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    const spare = list.json.recovery?.[0] ?? ''

    const { done } = await replace(token, spare)
    expect(done.status).toBe(200)
  })

  test('and a secret handed out before it came on cannot replace it later', async () => {
    const token = await signInWith(env, secret)
    await call(env, '/v1/second', {
      method: 'DELETE',
      token,
      body: { code: await codeAt(secret, step() + 1) },
    })
    const left = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const leftSecret = await secretHeldFor(env, left.json.holding ?? '')
    const { done: on, fresh } = await replace(token)
    expect(on.status).toBe(200)

    const late = await call<SecondView>(env, '/v1/second/confirm', {
      token,
      body: { holding: left.json.holding, code: await codeAt(leftSecret, step()) },
    })
    expect(late.status).toBe(400)

    expect(await signInWith(env, fresh)).toBeTruthy()
  })
})

describe('a second factor is asked wherever an address alone would sign in', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv(KEPT)
  })

  afterEach(() => env.close())

  async function enrolled(email: string): Promise<{ token: string; secret: string }> {
    const token = await signIn(env, email)
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)

    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    return { token, secret }
  }

  function consent(fields: Record<string, string>) {
    return call(env, '/oauth/authorize', {
      raw: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  async function asking(): Promise<Record<string, string>> {
    const redirect = 'https://chatgpt.com/connector/oauth/abc123'
    const registered = await call(env, '/oauth/register', {
      body: {
        client_name: 'ChatGPT',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'none',
      },
    })

    return {
      client_id: registered.json.client_id,
      redirect_uri: redirect,
      state: 'xyz',
      code_challenge: 'c'.repeat(43),
      resource: 'https://nibeditor.com/mcp',
    }
  }

  async function emailed(work: () => Promise<unknown>): Promise<string> {
    env.db.exec('delete from login_codes')
    const said = /(\d{3}) (\d{3})/.exec(await mail(work))
    return `${said?.[1]}${said?.[2]}`
  }

  test('on the consent page, before a connector is given a code', async () => {
    const { secret } = await enrolled('a@b.dev')
    const ask = await asking()

    const code = await emailed(() => consent({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await consent({ ...ask, action: 'allow', email: 'a@b.dev', code, write: '1' })

    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('location')).toBe(null)
    const holding = /name="holding" value="([a-f0-9]+)"/.exec(allowed.text)?.[1] ?? ''
    expect(holding).not.toBe('')
    expect(allowed.text).toContain('name="write" value="1"')

    const wrong = await consent({ ...ask, action: 'second', holding, code: '000000' })
    expect(wrong.status).toBe(200)
    expect(wrong.headers.get('location')).toBe(null)

    const right = await consent({
      ...ask,
      action: 'second',
      holding,
      write: '1',
      code: await codeAt(secret, step() + 1),
    })
    expect(right.status).toBe(302)
    expect(new URL(right.headers.get('location') ?? '').searchParams.get('code')).toBeTruthy()

    const again = await consent({
      ...ask,
      action: 'second',
      holding,
      code: await codeAt(secret, step() - 1),
    })
    expect(again.status).toBe(400)
  })

  test('and nothing but the page itself can stand in for the emailed half', async () => {
    await enrolled('a@b.dev')
    const ask = await asking()

    const made = await consent({ ...ask, action: 'second', holding: 'f'.repeat(64), code: '1' })
    expect(made.status).toBe(400)
    expect(made.headers.get('location')).toBe(null)
  })

  test('on an invitation, which lets the address in without signing it in', async () => {
    const { secret } = await enrolled('a@b.dev')
    const owner = await signIn(env, 'owner@b.dev')
    const listed = await call(env, '/v1/spaces', { token: owner })
    const space = (listed.json.spaces as { id: string }[])[0]?.id ?? ''

    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1] ?? ''

    const joined = await call<SecondView>(env, `/v1/join/${link}`, { method: 'POST', body: {} })
    expect(joined.status).toBe(200)
    expect(joined.json.token).toBeUndefined()
    expect(joined.json.second).toBe(true)

    const finished = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: joined.json.holding, code: await codeAt(secret, step() + 1) },
    })
    expect(finished.status).toBe(200)
    const session = finished.json.token ?? ''
    expect(session).not.toBe('')

    const walked = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      token: session,
      body: {},
    })
    expect(walked.status).toBe(200)
    const theirs = await call(env, '/v1/spaces', { token: session })
    expect(theirs.json.spaces.map((one: { id: string }) => one.id)).toContain(space)
  })
})

describe('how many codes may be tried', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv(KEPT)
  })

  afterEach(() => env.close())

  async function enrolled(email: string): Promise<{ token: string; secret: string }> {
    const token = await signIn(env, email)
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)

    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    return { token, secret }
  }

  function tryOne(token: string, code: string, machine: string) {
    return call<SecondView>(env, '/v1/second/recovery', {
      method: 'POST',
      token,
      body: { code },
      headers: { 'cf-connecting-ip': machine },
    })
  }

  test('stops at a number of tries for one account', async () => {
    const { token } = await enrolled('a@b.dev')

    for (let at = 0; at < 20; at++) await tryOne(token, '000000', '203.0.113.7')

    const refused = await tryOne(token, '000000', '203.0.113.7')
    expect(refused.status).toBe(400)
  })

  test('and at a number of tries from one machine, whoever they are about', async () => {
    const mine = await enrolled('a@b.dev')

    for (const email of ['c@d.dev', 'e@f.dev', 'g@h.dev']) {
      const { token } = await enrolled(email)
      for (let at = 0; at < 20; at++) await tryOne(token, '000000', '203.0.113.9')
    }

    const refused = await tryOne(mine.token, await codeAt(mine.secret, step() + 1), '203.0.113.9')
    expect(refused.status).toBe(400)

    const fine = await tryOne(mine.token, await codeAt(mine.secret, step() + 1), '203.0.113.10')
    expect(fine.status).toBe(200)
  })
})

describe('what an abandoned enrolment leaves behind', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv(KEPT)
  })

  afterEach(() => env.close())

  test('is swept by the nightly job, secret and all', async () => {
    const token = await signIn(env, 'a@b.dev')
    await call(env, '/v1/second', { token, body: {} })

    expect(secretOf(env)).toMatch(/^[0-9a-f]{40}$/)

    env.db.exec("update cached set until = 0 where scope = 'second-pending'")
    await nightly(env)

    expect(secretOf(env)).toBe('')
  })
})

describe('a secret of its own', () => {
  const AI = 'the AI key secret'
  const OWN_SECRET = 'the second factor secret'

  let env: TestEnv

  afterEach(() => env.close())

  async function enrolled(): Promise<string> {
    const token = await signIn(env, 'a@b.dev')
    const begun = await call<SecondView>(env, '/v1/second', { token, body: {} })
    const secret = secretOf(env)
    await call(env, '/v1/second/confirm', {
      token,
      body: { holding: begun.json.holding, code: await codeAt(secret, step()) },
    })

    return secret
  }

  function sealedNow(): string {
    const row = env.db.prepare('select totp_secret from users').get() as { totp_secret: string }
    return row.totp_secret
  }

  async function signsIn(secret: string, ahead: number): Promise<boolean> {
    const half = await signInHalfWay(env)
    const done = await call<SecondView>(env, '/v1/auth/second', {
      body: { holding: half.json.holding, code: await codeAt(secret, step() + ahead) },
    })

    return done.status === 200
  }

  test('is what a new factor is sealed under', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI, SECOND_FACTOR_SECRET: OWN_SECRET })
    await enrolled()

    expect(sealedNow().startsWith('own:')).toBe(true)
  })

  test('so rotating the AI key secret leaves the factor working', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI, SECOND_FACTOR_SECRET: OWN_SECRET })
    const secret = await enrolled()

    env.OPENAI_KEY_SECRET = 'a rotated AI key secret'

    expect(await signsIn(secret, 0)).toBe(true)
  })

  test('and rotating the factor secret leaves the AI key working', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI, SECOND_FACTOR_SECRET: OWN_SECRET })
    const token = await signIn(env, 'a@b.dev')
    const key = `sk-${'a'.repeat(48)}`
    await call(env, '/v1/ask/key', { method: 'PUT', token, body: { key } })

    env.SECOND_FACTOR_SECRET = 'a rotated second factor secret'

    const row = env.db.prepare('select id, openai_key from users').get() as {
      id: string
      openai_key: string
    }
    expect(await opened(AI, row.id, row.openai_key)).toBe(key)
  })

  test('without it, nothing changes: the factor is kept the way it was', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI })
    const secret = await enrolled()

    expect(sealedNow().startsWith('own:')).toBe(false)
    expect(await signsIn(secret, 0)).toBe(true)
  })

  test('a borrowed seal still opens once it exists, and moves on its next good code', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI })
    const secret = await enrolled()

    env.SECOND_FACTOR_SECRET = OWN_SECRET
    expect(await signsIn(secret, 0)).toBe(true)
    expect(sealedNow().startsWith('own:')).toBe(true)

    env.OPENAI_KEY_SECRET = 'a rotated AI key secret'
    expect(await signsIn(secret, 1)).toBe(true)
  })

  test('but not on a wrong one', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI })
    await enrolled()
    const before = sealedNow()

    env.SECOND_FACTOR_SECRET = OWN_SECRET
    const half = await signInHalfWay(env)
    await call(env, '/v1/auth/second', { body: { holding: half.json.holding, code: '000000' } })

    expect(sealedNow()).toBe(before)
  })

  test('and an account nobody signs in to moves with the nightly job', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI })
    const secret = await enrolled()

    env.SECOND_FACTOR_SECRET = OWN_SECRET
    await nightly(env)
    expect(sealedNow().startsWith('own:')).toBe(true)

    env.OPENAI_KEY_SECRET = 'a rotated AI key secret'
    expect(await signsIn(secret, 0)).toBe(true)
  })

  test('which leaves alone a seal it cannot open', async () => {
    env = testEnv({ OPENAI_KEY_SECRET: AI })
    await enrolled()
    const before = sealedNow()

    env.OPENAI_KEY_SECRET = 'rotated before the move'
    env.SECOND_FACTOR_SECRET = OWN_SECRET
    expect(await resealBorrowed(env)).toBe(0)
    expect(sealedNow()).toBe(before)
  })
})

describe('the sessions a reader can see', () => {
  let env: TestEnv
  let token: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')
  })

  afterEach(() => env.close())

  test('name the device that opened them, and say which is this one', async () => {
    const listed = await call<SecondView>(env, '/v1/sessions', { token })

    expect(listed.json.sessions).toHaveLength(1)
    expect(listed.json.sessions?.[0]?.current).toBe(true)
  })

  test('and one of them can be ended', async () => {
    const other = await signIn(env, 'a@b.dev')
    const listed = await call<SecondView>(env, '/v1/sessions', { token })
    const theirs = listed.json.sessions?.find((one) => !one.current)

    const gone = await call<SecondView>(env, `/v1/sessions/${theirs?.id ?? ''}`, {
      method: 'DELETE',
      token,
    })

    expect(gone.json.ok).toBe(true)

    const after = await call<SecondView>(env, '/v1/sessions', { token: other })
    expect(after.status).toBe(401)
  })

  test('or every one but this', async () => {
    await signIn(env, 'a@b.dev')
    await signIn(env, 'a@b.dev')

    const ended = await call<SecondView>(env, '/v1/sessions', { method: 'DELETE', token })
    expect(ended.json.ended).toBe(2)

    const mine = await call<SecondView>(env, '/v1/sessions', { token })
    expect(mine.json.sessions).toHaveLength(1)
  })

  test('and somebody else’s session is not theirs to end', async () => {
    const other = await signIn(env, 'c@d.dev')
    const listed = await call<SecondView>(env, '/v1/sessions', { token })
    const mine = listed.json.sessions?.[0]?.id ?? ''

    const gone = await call<SecondView>(env, `/v1/sessions/${mine}`, {
      method: 'DELETE',
      token: other,
    })

    expect(gone.json.ok).toBe(false)

    const still = await call<SecondView>(env, '/v1/sessions', { token })
    expect(still.status).toBe(200)
  })
})

function secretOf(env: TestEnv): string {
  const row = env.db
    .prepare("select value from cached where scope = 'second-pending' order by until desc limit 1")
    .get() as { value: string } | undefined

  return (row?.value ?? '').split(':')[1] ?? ''
}

async function secretHeldFor(env: TestEnv, holding: string): Promise<string> {
  const row = env.db
    .prepare("select value from cached where scope = 'second-pending' and key = ?")
    .get(await sha256(holding)) as { value: string } | undefined

  return (row?.value ?? '').split(':')[1] ?? ''
}

function step(): number {
  return Math.floor(Date.now() / 30_000)
}

async function signInHalfWay(env: TestEnv) {
  const { mail } = await import('./harness')
  env.db.exec('delete from login_codes')

  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email: 'a@b.dev' } }))
  const said = /(\d{3}) (\d{3})/.exec(logged)

  return await call<SecondView>(env, '/v1/auth/verify', {
    body: { email: 'a@b.dev', code: `${said?.[1] ?? ''}${said?.[2] ?? ''}` },
  })
}

async function signInWith(env: TestEnv, secret: string): Promise<string> {
  const half = await signInHalfWay(env)
  const done = await call<SecondView>(env, '/v1/auth/second', {
    body: { holding: half.json.holding, code: await codeAt(secret, step()) },
  })

  return done.json.token ?? ''
}
