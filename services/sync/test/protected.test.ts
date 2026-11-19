import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let other: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  other = await signIn(env, 'c@d.dev')
})

afterEach(() => env.close())

const HASH = { n: 32768, r: 8, p: 1, salt: 'c2FsdHNhbHQ=', hash: 'aGFzaGhhc2hoYXNo', at: 100 }

const read = (as = token) => call(env, '/v1/protected', { token: as })
const ways = (space: string, protectedWays: unknown, as = token) =>
  call(env, `/v1/protected/spaces/${space}`, {
    method: 'PUT',
    token: as,
    body: { protected: protectedWays },
  })
const since = (space: string, base: unknown, protectedWays: unknown) =>
  call(env, `/v1/protected/spaces/${space}`, {
    method: 'PUT',
    token,
    body: { protected: protectedWays, base },
  })
const password = (body: unknown) =>
  call(env, '/v1/protected/password', { method: 'PUT', token, body: { password: body } })

describe('what a reader protected', () => {
  test('starts as nothing', async () => {
    expect((await read()).json).toEqual({ password: null, spaces: {} })
  })

  test('is kept per space, the reader’s own and nobody else’s', async () => {
    expect((await ways('s1', { Diary: 'password', '': 'device' })).status).toBe(200)
    expect((await read()).json.spaces).toEqual({ s1: { Diary: 'password', '': 'device' } })
    expect((await read(other)).json.spaces).toEqual({})
  })

  test('keeps only paths inside a space and the two ways', async () => {
    await ways('s1', { ok: 'device', '../out': 'password', '/abs': 'device', x: 'pin' })
    expect((await read()).json.spaces).toEqual({ s1: { ok: 'device' } })
  })

  test('keeps a top-level name that begins like a drive, as macOS and Linux allow', async () => {
    await ways('s1', { 'Q: Diary.md': 'password', 'W: Work/Plan.md': 'device', 'C:\\x': 'device' })
    expect((await read()).json.spaces).toEqual({
      s1: { 'Q: Diary.md': 'password', 'W: Work/Plan.md': 'device' },
    })
  })

  test('is replaced whole for a space, and an empty map takes the space away', async () => {
    await ways('s1', { Diary: 'password' })
    await ways('s1', { Work: 'device' })
    expect((await read()).json.spaces).toEqual({ s1: { Work: 'device' } })
    await ways('s1', {})
    expect((await read()).json.spaces).toEqual({})
  })

  test('sent with what the device last had, keeps what another device locked meanwhile', async () => {
    await ways('s1', { Plans: 'password' })
    await ways('s1', { Plans: 'password', Diary: 'password' })
    const answer = await since('s1', { Plans: 'password' }, { Plans: 'password', Taxes: 'device' })
    const merged = { Plans: 'password', Diary: 'password', Taxes: 'device' }
    expect((answer.json as unknown as { spaces: Record<string, unknown> }).spaces.s1).toEqual(merged)
    expect((await read()).json.spaces).toEqual({ s1: merged })
  })

  test('sent with what the device last had, takes away only what that device took away', async () => {
    await ways('s1', { Plans: 'password', Diary: 'password', Work: 'device' })
    await since('s1', { Plans: 'password', Diary: 'password' }, { Diary: 'password' })
    expect((await read()).json.spaces).toEqual({ s1: { Diary: 'password', Work: 'device' } })
    await ways('s1', { Work: 'device' })
    await since('s1', { Diary: 'password', Work: 'device' }, { Diary: 'password', Work: 'device' })
    expect((await read()).json.spaces).toEqual({ s1: { Work: 'device' } })
  })

  test('keeps a path too long to hold as the folder above it that fits', async () => {
    const deep = `${'a'.repeat(200)}/${'b'.repeat(150)}/Diary.md`
    await ways('s1', { [deep]: 'password' })
    expect((await read()).json.spaces).toEqual({ s1: { ['a'.repeat(200)]: 'password' } })
  })

  test('takes a password hash, and keeps the newer of two', async () => {
    expect((await password(HASH)).status).toBe(200)
    await password({ ...HASH, hash: 'b2xkZXJvbGRlcg==', at: 50 })
    expect((await read()).json.password).toEqual(HASH)
    await password({ ...HASH, hash: 'bmV3ZXJuZXdlcg==', at: 200 })
    expect((await read()).json.password?.hash).toBe('bmV3ZXJuZXdlcg==')
  })

  test('keeps what another device protected at the same moment', async () => {
    env.justBefore(/update users set protected/, () =>
      env.db
        .prepare("update users set protected = ? where email = 'a@b.dev'")
        .run(JSON.stringify({ password: null, spaces: { s2: { Diary: 'password' } } })),
    )

    expect((await ways('s1', { Work: 'device' })).status).toBe(200)
    expect((await read()).json.spaces).toEqual({
      s1: { Work: 'device' },
      s2: { Diary: 'password' },
    })
  })

  test('keeps a space protected meanwhile when a password arrives', async () => {
    env.justBefore(/update users set protected/, () =>
      env.db
        .prepare("update users set protected = ? where email = 'a@b.dev'")
        .run(JSON.stringify({ password: null, spaces: { s2: { Diary: 'password' } } })),
    )

    expect((await password(HASH)).status).toBe(200)
    expect((await read()).json).toEqual({ password: HASH, spaces: { s2: { Diary: 'password' } } })
  })

  test('refuses what is not a hash the app wrote', async () => {
    expect((await password({ ...HASH, n: 1000 })).status).toBe(400)
    expect((await password('tulip ladder')).status).toBe(400)
  })
})
