import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, file, signIn, testEnv, type TestEnv } from './harness'
import { QUOTA } from '../src/storage'

let env: TestEnv
let token: string
/** What the account holds before a test uploads anything: a new one is given a
 *  space with a note in it, and what these tests measure is what images add. */
let start: number

/** A name that is a hash, for the tests that never get as far as the bytes. */
const HASH = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** A picture of `size` bytes and the hash it is named by: the same bytes every time
 *  it is asked for, so one test can name the picture it uploaded. */
const sized = (size: number) => file(size, 7)

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  start = (await call(env, '/v1/usage', { token })).json.used
})

afterEach(() => env.close())

/** Uploads bytes under their hash, the way the editor does after a paste. */
function upload(
  contents: { bytes: Uint8Array; hash: string },
  options: { token?: string; type?: string } = {},
) {
  return call(env, `/v1/blobs/${contents.hash}`, {
    method: 'PUT',
    token: options.token ?? token,
    raw: contents.bytes,
    headers: { 'content-type': options.type ?? 'image/png' },
  })
}

describe('storing an image', () => {
  test('keeps it and says so', async () => {
    const response = await upload(sized(1024))

    expect(response.status).toBe(201)
    expect(response.json.stored).toBe(true)
  })

  test('the second time is free, because the hash is the same picture', async () => {
    await upload(sized(1024))
    const again = await upload(sized(1024))

    expect(again.status).toBe(200)
    expect(again.json.stored).toBe(false)
  })

  test('counts once however many times it is offered', async () => {
    await upload(sized(4096))
    await upload(sized(4096))

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start + 4096)
  })

  /** A paste that went up twice at once - the same picture in two notes, saved
   *  together - found the row already there by the time it wrote and answered with
   *  a 500, because the check above is a courtesy and the primary key is the rule.
   *  The other upload's row goes in at the one moment that matters. */
  test('the same picture offered twice at once is one row', async () => {
    const owner = (env.db.prepare('select id from users limit 1').get() as { id: string }).id
    env.justBefore(/insert into blobs/, () => {
      env.db
        .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
        .run(sized(4096).hash, owner, 4096, 'image/png', 1)
    })

    const response = await upload(sized(4096))

    expect(response.status).not.toBe(500)
    expect(
      env.db.prepare('select hash from blobs where hash = ?').all(sized(4096).hash),
    ).toHaveLength(1)
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start + 4096)
  })

  test('refuses something that is not an image', async () => {
    const response = await upload(sized(32), { type: 'application/zip' })
    expect(response.status).toBe(415)
  })

  test('refuses a name that is not a hash', async () => {
    const response = await upload({ bytes: new Uint8Array(32), hash: 'not-a-hash' })
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

/** Every account that keeps the same file is served one object under its hash, so
 *  the hash is what the bytes have to be: bytes under somebody else's hash were their
 *  picture, or their published site's script, replaced for all of them. */
describe('bytes under a hash that is not theirs', () => {
  test('are refused', async () => {
    const real = file(64, 1)
    const response = await call(env, `/v1/blobs/${real.hash}`, {
      method: 'PUT',
      token,
      raw: file(64, 2).bytes,
      headers: { 'content-type': 'image/png' },
    })

    expect(response.status).toBe(400)
    expect(env.db.prepare('select hash from blobs where hash = ?').all(real.hash)).toHaveLength(0)
  })

  test('never replace the copy another account already keeps', async () => {
    const script = file(64, 1)
    await call(env, `/v1/blobs/${script.hash}`, {
      method: 'PUT',
      token,
      raw: script.bytes,
      headers: { 'content-type': 'text/javascript' },
    })

    const stranger = await signIn(env, 'c@d.dev')
    await call(env, `/v1/blobs/${script.hash}`, {
      method: 'PUT',
      token: stranger,
      raw: file(64, 2).bytes,
      headers: { 'content-type': 'text/html' },
    })
    await call(env, `/v1/blobs/${script.hash}`, {
      method: 'PUT',
      token: stranger,
      raw: script.bytes,
      headers: { 'content-type': 'image/png' },
    })

    const stored = await env.NOTES.get(`blobs/${script.hash}`)
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(script.bytes)
    expect(stored!.httpMetadata?.contentType).toBe('text/javascript')
  })
  /** What was in the bucket before bytes were checked can be anything under any
   *  name, and the next account to bring the right bytes for that name mends it. */
  test('are replaced by the bytes the hash names when those arrive', async () => {
    const real = file(64, 1)
    const owner = (env.db.prepare('select id from users limit 1').get() as { id: string }).id
    await env.NOTES.put(`blobs/${real.hash}`, file(64, 2).bytes, {
      httpMetadata: { contentType: 'image/svg+xml' },
    })
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(real.hash, owner, 64, 'image/svg+xml', 1)

    const stranger = await signIn(env, 'c@d.dev')
    const response = await call(env, `/v1/blobs/${real.hash}`, {
      method: 'PUT',
      token: stranger,
      raw: real.bytes,
      headers: { 'content-type': 'image/png' },
    })

    expect(response.status).toBe(201)
    const stored = await env.NOTES.get(`blobs/${real.hash}`)
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(real.bytes)
    expect(stored!.httpMetadata?.contentType).toBe('image/png')
  })

  /** A drawn diagram is the one blob named by something other than its bytes - its
   *  fence and its space - so the name is all there is to check, and it is a name
   *  no page prints. What it can never do is write over a drawing already there. */
  test('as a diagram, are kept under its name but never over one already drawn', async () => {
    const key = 'd'.repeat(64)
    const drawing = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const first = await call(env, `/v1/blobs/${key}`, {
      method: 'PUT',
      token,
      raw: drawing,
      headers: { 'content-type': 'image/svg+xml' },
    })
    expect(first.status).toBe(201)

    const stranger = await signIn(env, 'c@d.dev')
    await call(env, `/v1/blobs/${key}`, {
      method: 'PUT',
      token: stranger,
      raw: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>no</text></svg>',
      ),
      headers: { 'content-type': 'image/svg+xml' },
    })

    const stored = await env.NOTES.get(`blobs/${key}`)
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(drawing)
    // And the stranger is given no row for it: a row is what lets a post name a blob.
    expect(env.db.prepare('select hash from blobs where hash = ?').all(key)).toHaveLength(1)
  })
})

describe('serving an image', () => {
  test('hands it back to anyone with the hash, no session needed', async () => {
    await upload(sized(64))
    const response = await call(env, `/i/${sized(64).hash}.png`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  test('caches forever, since the name is the contents', async () => {
    await upload(sized(64))
    const response = await call(env, `/i/${sized(64).hash}.png`)

    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  test('is a miss for something never stored', async () => {
    expect((await call(env, `/i/${OTHER}.png`)).status).toBe(404)
  })
})

/** A stylesheet and a script are the two types a browser does something with, and
 *  every published site is a host under one shared domain: a script served on all
 *  of them is a script inside all of their origins. So each is served only on the
 *  site whose own pages ask for it. */
describe('serving what a site is dressed in', () => {
  /** A space of this account's, published at `field.nibeditor.com`. */
  async function published(): Promise<string> {
    const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
    const space: string = created.json.space.id

    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Hello.md', content: '# Hello\n' },
    })
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })

    return space
  }

  test('only on the site that keeps it beside its notes', async () => {
    const space = await published()
    await upload(sized(64), { type: 'text/javascript' })
    await call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token,
      body: { files: [{ path: 'publish.js', hash: sized(64).hash }] },
    })

    expect(
      (await call(env, `/i/${sized(64).hash}.js`, { host: 'field.nibeditor.com' })).status,
    ).toBe(200)
    // Not on anybody else's site, and not on the app's own origin.
    expect(
      (await call(env, `/i/${sized(64).hash}.js`, { host: 'other.nibeditor.com' })).status,
    ).toBe(404)
    expect((await call(env, `/i/${sized(64).hash}.js`, { host: 'nibeditor.com' })).status).toBe(404)
    expect((await call(env, `/i/${sized(64).hash}.js`)).status).toBe(404)
  })

  test('and a theme stylesheet on the site that installed it', async () => {
    const space = await published()
    await upload(sized(64), { type: 'text/css' })
    await call(env, `/v1/spaces/${space}/site`, {
      method: 'PUT',
      token,
      body: { theme: { name: 'Paper', hash: sized(64).hash } },
    })

    expect(
      (await call(env, `/i/${sized(64).hash}.css`, { host: 'field.nibeditor.com' })).status,
    ).toBe(200)
    expect(
      (await call(env, `/i/${sized(64).hash}.css`, { host: 'other.nibeditor.com' })).status,
    ).toBe(404)
  })
})

describe('giving an image back', () => {
  test('stops it counting', async () => {
    await upload(sized(2048))
    await call(env, `/v1/blobs/${sized(2048).hash}`, { method: 'DELETE', token })

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start)
  })

  test('leaves it served while another account still keeps it', async () => {
    const other = await signIn(env, 'other@b.dev')
    await upload(sized(2048))
    await upload(sized(2048), { token: other })

    await call(env, `/v1/blobs/${sized(2048).hash}`, { method: 'DELETE', token })

    expect((await call(env, `/i/${sized(2048).hash}.png`)).status).toBe(200)
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
    await upload(sized(1500))

    const usage = await call(env, '/v1/usage', { token })
    expect(usage.json.used).toBe(start + 2000)
    expect(usage.json.limit).toBe(QUOTA)
  })

  /** Leaving Recently deleted out was the way round the whole limit: fill the
   *  account, delete the lot, fill it again, and every round put another copy in
   *  the bucket for a fortnight that nobody was charged for. */
  test('counts a note in Recently deleted, whose bytes are still kept', async () => {
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const note = await call(env, `/v1/spaces/${space.json.space.id}/notes`, {
      token,
      body: { path: 'a.md', content: 'x'.repeat(5000) },
    })
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start + 5000)

    await call(env, `/v1/notes/${note.json.note.id}`, { method: 'DELETE', token })
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start + 5000)

    // Purged is when the bytes have gone, and only then do they stop counting.
    await call(env, `/v1/trash/notes/${note.json.note.id}`, { method: 'DELETE', token })
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start)
  })

  test('is counted per account', async () => {
    const other = await signIn(env, 'other@b.dev')
    const before = (await call(env, '/v1/usage', { token: other })).json.used
    await upload(sized(4096))

    const theirs = await call(env, '/v1/usage', { token: other })
    expect(theirs.json.used).toBe(before)
  })

  test('turns away an image that would not fit', async () => {
    // Fill the account to the brim first, then offer one more byte.
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(OTHER, owner.id, QUOTA, 'image/png', 1)

    const response = await upload(sized(1))
    expect(response.status).toBe(507)
  })
})
