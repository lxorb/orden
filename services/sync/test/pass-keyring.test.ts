import { MOST_KEYRING_BYTES } from '@orden/pass/wire'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import { aKeyring, pass, passCall, type Person, person, sealed } from './pass-fakes'

let env: TestEnv
let ada: Person
let api: ReturnType<typeof pass>

beforeEach(async () => {
  env = testEnv()
  ada = await person(env, 'ada@example.com')
  api = pass(env)
})

afterEach(() => env.close())

describe('a keyring', () => {
  test('is made at revision 0 and comes back in the changes', async () => {
    const keyring = aKeyring(5)
    const made = await api.keyring(ada, 0, keyring)
    expect(made.status).toBe(200)
    expect(made.json.rev).toBe(1)

    const changes = await api.changes(ada)
    expect(changes.keyring).toEqual({ keyring, rev: 1 })
    expect((await api.changes(ada, changes.seq)).keyring).toBeNull()
  })

  test('is not made twice, and a second device is shown the first one', async () => {
    const first = aKeyring(1)
    await api.keyring(ada, 0, first)

    const again = await api.keyring(ada, 0, aKeyring(2))
    expect(again.status).toBe(409)
    expect(again.json).toEqual({ error: 'stale', current: { keyring: first, rev: 1 } })
  })

  test('changes only over the revision it was read at', async () => {
    const first = aKeyring(1)
    await api.keyring(ada, 0, first)

    const changed = await api.keyring(ada, 1, { ...first, private: sealed(200), at: 2 })
    expect(changed.json.rev).toBe(2)

    const stale = await api.keyring(ada, 1, { ...first, at: 3 })
    expect(stale.status).toBe(409)
    expect((stale.json.current as { rev: number }).rev).toBe(2)
  })

  test('keeps its public key', async () => {
    const first = aKeyring(1)
    await api.keyring(ada, 0, first)

    const swapped = await api.keyring(ada, 1, { ...aKeyring(2), at: 2 })
    expect(swapped.status).toBe(400)
    expect(swapped.json.error).toBe('a keyring keeps its public key')
  })

  test('only moves forward in time', async () => {
    const first = aKeyring(10)
    await api.keyring(ada, 0, first)

    expect((await api.keyring(ada, 1, { ...first, at: 10 })).status).toBe(400)
    expect((await api.keyring(ada, 1, { ...first, at: 9 })).status).toBe(400)
    expect((await api.keyring(ada, 1, { ...first, at: 11 })).status).toBe(200)
  })

  test('refuses junk and anything too large', async () => {
    const junk: unknown[] = [
      { rev: 0 },
      { keyring: 'text', rev: 0 },
      { keyring: { ...aKeyring(), v: 2 }, rev: 0 },
      { keyring: { ...aKeyring(), pub: 'not base64!' }, rev: 0 },
      { keyring: aKeyring(), rev: -1 },
      { keyring: aKeyring(), rev: 1.5 },
      { keyring: { ...aKeyring(), private: sealed(MOST_KEYRING_BYTES) }, rev: 0 },
    ]
    for (const body of junk) {
      expect((await passCall(env, ada, 'PUT', '/keyring', body)).status, JSON.stringify(body)).toBe(
        400,
      )
    }
    expect(
      (await call(env, '/v2/pass/keyring', { method: 'PUT', token: ada.token, raw: '[]' })).status,
    ).toBe(400)
    expect(env.db.prepare('select count(*) as n from pass_keyrings').get()).toEqual({ n: 0 })
  })

  test('is nobody else’s to read: another account sees its own', async () => {
    await api.keyring(ada, 0, aKeyring(1))
    const bob = await person(env, 'bob@example.com')
    expect((await api.changes(bob)).keyring).toBeNull()
  })
})

describe('somebody’s public key', () => {
  test('is there once they have a keyring, and null before', async () => {
    const bob = await person(env, 'bob@example.com')
    const lookup = () =>
      passCall<{ pub: string | null }>(env, ada, 'GET', '/people/key?email=Bob@Example.com')

    expect((await lookup()).json).toEqual({ pub: null, signPub: null })
    const keyring = aKeyring(1)
    await api.keyring(bob, 0, keyring)
    expect((await lookup()).json).toEqual({ pub: keyring.pub, signPub: null })
  })

  test('is null for an address with no account, and refused for no address', async () => {
    expect((await passCall(env, ada, 'GET', '/people/key?email=nobody@example.com')).json).toEqual({
      pub: null,
      signPub: null,
    })
    expect((await passCall(env, ada, 'GET', '/people/key?email=nope')).status).toBe(400)
  })

  test('is looked up only so often', async () => {
    let status = 200
    for (let tries = 0; tries < 301 && status === 200; tries++) {
      status = (await passCall(env, ada, 'GET', '/people/key?email=x@example.com')).status
    }
    expect(status).toBe(429)
  })
})
