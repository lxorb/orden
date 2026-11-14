import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type TestEnv, testEnv } from '../../sync-server/test/fakes'
import { blobs, publicBlobs } from '../src/blobs'
import { MOST_SITES, siteOf } from '../src/site-icons'

const USER = { id: 'user-1', email: 'a@b.dev', name: null, created_at: 0 }

type Routes = typeof blobs extends Hono<infer Bound> ? Bound : never

let env: TestEnv
let app: Hono<Routes>

beforeEach(() => {
  env = testEnv()
  env.db
    .prepare('insert into users (id, email, created_at) values (?, ?, ?)')
    .run(USER.id, USER.email, USER.created_at)
  app = new Hono<Routes>()
  app.use('/v1/*', async (context, next) => {
    context.set('user', USER)
    context.set('who', { kind: 'user', user: USER })
    await next()
  })
  app.route('/v1/blobs', blobs)
  app.route('/i', publicBlobs)
})

afterEach(() => {
  env.close()
})

function png(seed: number): { bytes: Uint8Array; hash: string } {
  const bytes = new Uint8Array(64).fill(seed)
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
}

async function put(hash: string, bytes: Uint8Array, type = 'image/png'): Promise<Response> {
  return await app.request(
    `/v1/blobs/${hash}`,
    { method: 'PUT', body: bytes, headers: { 'content-type': type } },
    env,
  )
}

describe('storing a blob', () => {
  test('bytes are stored once under their hash and served immutable', async () => {
    const { bytes, hash } = png(1)
    const stored = await put(hash, bytes)
    expect(stored.status).toBe(201)
    expect(await stored.json()).toEqual({ hash, stored: true })

    const again = await put(hash, bytes)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ hash, stored: false })

    const served = await app.request(`/i/${hash}.png`, {}, env)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes)
  })

  test('bytes that are not their hash, an unknown type and an empty body are refused', async () => {
    const { bytes } = png(2)
    const { hash } = png(3)
    expect((await put(hash, bytes)).status).toBe(400)
    expect((await put(hash, bytes, 'text/plain')).status).toBe(415)
    expect((await put(png(4).hash, new Uint8Array(0))).status).toBe(400)
    expect((await put('not-a-hash', bytes)).status).toBe(400)
  })

  test('a blob nobody reads any more is let go, and the bytes with it', async () => {
    const { bytes, hash } = png(5)
    await put(hash, bytes)
    const gone = await app.request(`/v1/blobs/${hash}`, { method: 'DELETE' }, env)
    expect(gone.status).toBe(200)
    expect((await app.request(`/i/${hash}.png`, {}, env)).status).toBe(404)
    expect(env.keys()).not.toContain(`blobs/${hash}`)
  })

  test('what was never stored is not found', async () => {
    expect((await app.request(`/i/${png(6).hash}.png`, {}, env)).status).toBe(404)
    expect((await app.request('/i/junk.png', {}, env)).status).toBe(404)
  })
})

describe('site icons', () => {
  test('a site is a lowercase hostname and nothing else', () => {
    expect(siteOf('Example.com')).toBe('example.com')
    expect(siteOf('docs.example.co.uk')).toBe('docs.example.co.uk')
    expect(siteOf('localhost')).toBeNull()
    expect(siteOf('not a host')).toBeNull()
    expect(siteOf(42)).toBeNull()
    expect(MOST_SITES).toBeGreaterThan(0)
  })
})
