import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { QUOTA } from '../src/storage'

let env: TestEnv
let token: string
/** What the account holds before a test uploads anything: a new one is given a
 *  space with a note in it, and what these tests measure is what images add. */
let start: number

/** A hash is 64 hex characters; the contents behind it never matter here. */
const HASH = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  start = (await call(env, '/v1/usage', { token })).json.used
})

afterEach(() => env.close())

/** Uploads bytes under a hash, the way the editor does after a paste. */
function upload(hash: string, bytes: number, options: { token?: string; type?: string } = {}) {
  return call(env, `/v1/blobs/${hash}`, {
    method: 'PUT',
    token: options.token ?? token,
    raw: new Uint8Array(bytes),
    headers: { 'content-type': options.type ?? 'image/png' },
  })
}

describe('storing an image', () => {
  test('keeps it and says so', async () => {
    const response = await upload(HASH, 1024)

    expect(response.status).toBe(201)
    expect(response.json.stored).toBe(true)
  })

  test('the second time is free, because the hash is the same picture', async () => {
    await upload(HASH, 1024)
    const again = await upload(HASH, 1024)

    expect(again.status).toBe(200)
    expect(again.json.stored).toBe(false)
  })

  test('counts once however many times it is offered', async () => {
    await upload(HASH, 4096)
    await upload(HASH, 4096)

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start + 4096)
  })

  test('refuses something that is not an image', async () => {
    const response = await upload(HASH, 32, { type: 'application/zip' })
    expect(response.status).toBe(415)
  })

  test('refuses a name that is not a hash', async () => {
    const response = await upload('not-a-hash', 32)
    expect(response.status).toBe(400)
  })

  test('needs a session', async () => {
    const response = await call(env, `/v1/blobs/${HASH}`, {
      method: 'PUT',
      raw: new Uint8Array(8),
      headers: { 'content-type': 'image/png' },
    })

    expect(response.status).toBe(401)
  })
})

describe('serving an image', () => {
  test('hands it back to anyone with the hash, no session needed', async () => {
    await upload(HASH, 64)
    const response = await call(env, `/i/${HASH}.png`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  test('caches forever, since the name is the contents', async () => {
    await upload(HASH, 64)
    const response = await call(env, `/i/${HASH}.png`)

    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  test('is a miss for something never stored', async () => {
    expect((await call(env, `/i/${OTHER}.png`)).status).toBe(404)
  })
})

describe('giving an image back', () => {
  test('stops it counting', async () => {
    await upload(HASH, 2048)
    await call(env, `/v1/blobs/${HASH}`, { method: 'DELETE', token })

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start)
  })

  test('leaves it served while another account still keeps it', async () => {
    const other = await signIn(env, 'other@b.dev')
    await upload(HASH, 2048)
    await upload(HASH, 2048, { token: other })

    await call(env, `/v1/blobs/${HASH}`, { method: 'DELETE', token })

    expect((await call(env, `/i/${HASH}.png`)).status).toBe(200)
  })
})

describe('a name that is not a hash', () => {
  test('cannot be given back either', async () => {
    // The name becomes an object key, so one that could never have been stored
    // has no business reaching the bucket.
    const response = await call(env, '/v1/blobs/%2e%2e%2fspaces%2fsomebody-else', {
      method: 'DELETE',
      token,
    })

    expect(response.status).toBe(400)
    expect((await call(env, '/v1/blobs/not-a-hash', { method: 'DELETE', token })).status).toBe(400)
  })
})

describe('an upload that is too big', () => {
  test('is turned away on what it says, before its body is read', async () => {
    const response = await call(env, `/v1/blobs/${HASH}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(8),
      headers: { 'content-type': 'image/png', 'content-length': String(64 * 1024 * 1024) },
    })

    expect(response.status).toBe(413)
  })
})

describe('the quota', () => {
  test('counts notes as well as images', async () => {
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
    await call(env, `/v1/spaces/${space.json.space.id}/notes`, {
      token,
      body: { path: 'a.md', content: 'x'.repeat(500) },
    })
    await upload(HASH, 1500)

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start + 2000)
    expect(usage.json.limit).toBe(QUOTA)
  })

  test('is counted per account', async () => {
    const other = await signIn(env, 'other@b.dev')
    const before = (await call(env, '/v1/usage', { token: other })).json.used
    await upload(HASH, 4096)

    const theirs = await call(env, '/v1/usage', { token: other })
    expect(theirs.json.used).toBe(before)
  })

  test('turns away an image that would not fit', async () => {
    // Fill the account to the brim first, then offer one more byte.
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(OTHER, owner.id, QUOTA, 'image/png', 1)

    const response = await upload(HASH, 1)
    expect(response.status).toBe(507)
  })
})
