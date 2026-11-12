import { diagramKey } from '@orden/markdown/diagrams'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { call, file, mail, signIn, testEnv, type TestEnv } from './harness'
import { QUOTA } from '../src/sync-server/src/storage'

let env: TestEnv
let token: string
let start: number

const HASH = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const sized = (size: number) => file(size, 7)

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  start = (await call(env, '/v1/usage', { token })).json.used
})

afterEach(() => env.close())

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
    expect(env.db.prepare('select hash from blobs where hash = ?').all(key)).toHaveLength(1)
  })

  test('as a diagram with its fence, are kept only under the name that fence makes', async () => {
    const space = (env.db.prepare('select id from spaces limit 1').get() as { id: string }).id
    const fence = { space, language: 'mermaid', scheme: 'light', code: 'graph TD\n  A --> B' }
    const key = await diagramKey(space, fence.language, fence.code, 'light')
    const drawing = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const put = (hash: string, said: Record<string, string>, as = token) =>
      call(env, `/v1/blobs/${hash}`, {
        method: 'PUT',
        token: as,
        raw: drawing,
        headers: {
          'content-type': 'image/svg+xml',
          'x-orden-diagram': new URLSearchParams(said).toString(),
        },
      })

    expect((await put('d'.repeat(64), fence)).status).toBe(400)
    expect((await put(key, { ...fence, code: 'graph TD\n  A --> C' })).status).toBe(400)
    expect((await put(key, fence, await signIn(env, 'c@d.dev'))).status).toBe(400)
    expect(env.db.prepare('select hash from blobs where type = ?').all('image/svg+xml')).toEqual([])

    expect((await put(key, fence)).status).toBe(201)
  })

  test('that spell out a diagram’s name are not the file that name holds', async () => {
    const space = (env.db.prepare('select id from spaces limit 1').get() as { id: string }).id
    const fence = { space, language: 'mermaid', scheme: 'light', code: 'graph TD\n  A --> B' }
    const key = await diagramKey(space, fence.language, fence.code, 'light')
    const drawing = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const drawn = await call(env, `/v1/blobs/${key}`, {
      method: 'PUT',
      token,
      raw: drawing,
      headers: {
        'content-type': 'image/svg+xml',
        'x-orden-diagram': new URLSearchParams(fence).toString(),
      },
    })
    expect(drawn.status).toBe(201)

    const stranger = await signIn(env, 'c@d.dev')
    const named = new TextEncoder().encode(
      `nib/diagram/v1\n${space}\nmermaid\nlight\n${fence.code}`,
    )
    for (const [route, type] of [
      ['/v1/blobs', 'text/javascript'],
      ['/v2/blobs', 'text/javascript'],
      ['/v1/blobs', 'image/svg+xml'],
    ] as const) {
      const sent = await call(env, `${route}/${key}`, {
        method: 'PUT',
        token: stranger,
        raw: named,
        headers: { 'content-type': type },
      })
      expect(sent.status).toBe(400)
    }
    const started = await call<{ upload: string }>(env, '/v2/blobs/parts', {
      token: stranger,
      body: { hash: key, size: named.length },
    })
    const part = await call<{ part: number; etag: string }>(
      env,
      `/v2/blobs/parts/${started.json.upload}/1`,
      { method: 'PUT', token: stranger, raw: named },
    )
    const done = await call(env, `/v2/blobs/parts/${started.json.upload}`, {
      token: stranger,
      body: { parts: [part.json] },
    })
    expect(done.status).toBe(400)

    const stored = await env.NOTES.get(`blobs/${key}`)
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(drawing)
    expect(stored!.httpMetadata?.contentType).toBe('image/svg+xml')
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(key)).toHaveLength(1)
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

describe('serving what a site is dressed in', () => {
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
  test('hands it to the owner of a space that still uses it, rather than deleting it', async () => {
    const owner = await signIn(env, 'owner@b.dev')
    const theirs = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', {
        token: owner,
        body: { name: 'Theirs' },
      })
    ).json.space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })

    const picture = sized(2048)
    await upload(picture)
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'N.md', content: `![](https://nibeditor.com/i/${picture.hash}.png)` },
    })
    const pages = (
      await call<{ note: { id: string } }>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: { path: 'L.pages', content: '{}' },
      })
    ).json.note.id
    const pdf = new TextEncoder().encode('%PDF-1.4\ngiven back\n%%EOF\n')
    const paper = createHash('sha256').update(pdf).digest('hex')
    await upload({ bytes: pdf, hash: paper }, { type: 'application/pdf' })
    await call(env, `/v1/notes/${pages}/paper`, { method: 'PUT', token, body: { hash: paper } })
    await call(env, `/v1/spaces/${theirs}/share/members/a%40b.dev`, {
      method: 'DELETE',
      token: owner,
    })

    for (const hash of [picture.hash, paper]) {
      expect((await call(env, `/v1/blobs/${hash}`, { method: 'DELETE', token })).status).toBe(200)
    }

    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect((await call(env, `/v1/notes/${pages}/paper`, { token: owner })).status).toBe(200)
    const ownerId = env.db.prepare("select id from users where email = 'owner@b.dev'").get() as {
      id: string
    }
    for (const hash of [picture.hash, paper]) {
      expect(env.db.prepare('select user_id from blobs where hash = ?').all(hash)).toEqual([
        { user_id: ownerId.id },
      ])
    }
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start)
  })

  test('hands it over even while a stranger holds the same bytes as something else', async () => {
    const owner = await signIn(env, 'owner@b.dev')
    const stranger = await signIn(env, 'stranger@b.dev')
    const theirs = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', {
        token: owner,
        body: { name: 'Theirs' },
      })
    ).json.space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })

    const picture = sized(2048)
    await upload(picture)
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token,
      body: { path: 'N.md', content: `![](https://nibeditor.com/i/${picture.hash}.png)` },
    })
    expect((await upload(picture, { token: stranger, type: 'application/pdf' })).status).toBe(201)

    await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token })
    await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token: stranger })

    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
  })

  test('hands it over from a note the sweep has not read yet', async () => {
    const owner = await signIn(env, 'owner@b.dev')
    const theirs = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', {
        token: owner,
        body: { name: 'Theirs' },
      })
    ).json.space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })

    const picture = sized(2048)
    await upload(picture)
    const note = (
      await call<{ note: { id: string } }>(env, `/v1/spaces/${theirs}/notes`, {
        token,
        body: { path: 'N.md', content: `![](https://nibeditor.com/i/${picture.hash}.png)` },
      })
    ).json.note.id
    env.db.prepare('delete from note_pictures where note_id = ?').run(note)
    env.db.prepare('update notes set front_rev = 1 where id = ?').run(note)

    await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token })

    expect((await call(env, `/i/${picture.hash}.png`)).status).toBe(200)
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start)
  })

  test('keeps it rather than guessing while a space it writes in is unread', async () => {
    const owner = await signIn(env, 'owner@b.dev')
    const theirs = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', {
        token: owner,
        body: { name: 'Theirs' },
      })
    ).json.space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    for (let at = 0; at < 260; at++) {
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, updated_at, size, hash, front_rev)
           values (?, ?, ?, ?, ?, 5, 'h', 1)`,
        )
        .run(`old${String(at)}`, theirs, `old${String(at)}.md`, 1000 + at, 1)
    }
    const ownerBefore = (await call(env, '/v1/usage', { token: owner })).json.used

    const picture = sized(4096)
    await upload(picture)
    const given = await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token })

    expect(given.status).toBe(409)
    expect((await call(env, '/v1/usage', { token: owner })).json.used).toBe(ownerBefore)
    expect(
      env.db.prepare('select count(*) as n from blobs where hash = ?').get(picture.hash),
    ).toEqual({ n: 1 })
  })

  test('and deletes it when only its own notes show it', async () => {
    const own = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', { token, body: { name: 'Mine' } })
    ).json.space.id
    const picture = sized(2048)
    await upload(picture)
    await call(env, `/v1/spaces/${own}/notes`, {
      token,
      body: { path: 'N.md', content: `![](https://nibeditor.com/i/${picture.hash}.png)` },
    })

    await call(env, `/v1/blobs/${picture.hash}`, { method: 'DELETE', token })

    expect(env.keys()).not.toContain(`blobs/${picture.hash}`)
  })
})

describe('a name that is not a hash', () => {
  test('cannot be given back either', async () => {
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

  test('counts a note in Recently deleted, whose bytes are still kept', async () => {
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const note = await call(env, `/v1/spaces/${space.json.space.id}/notes`, {
      token,
      body: { path: 'a.md', content: 'x'.repeat(5000) },
    })
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start + 5000)

    await call(env, `/v1/notes/${note.json.note.id}`, { method: 'DELETE', token })
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(start + 5000)

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

  test('lets one of two uploads through when only one fits, however they land', async () => {
    const owner = (env.db.prepare('select id from users limit 1').get() as { id: string }).id
    const size = 4096
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(OTHER, owner, QUOTA - start - size - 1, 'image/png', 1)
    const first = file(size, 1)
    const second = file(size, 2)

    env.justBefore(/insert into blobs/, () => {
      env.db
        .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
        .run(second.hash, owner, size, 'image/png', 1)
    })
    const response = await upload(first)

    expect(response.status).toBe(507)
    expect(env.db.prepare('select hash from blobs where hash = ?').all(first.hash)).toEqual([])
    expect(env.keys()).not.toContain(`blobs/${first.hash}`)
    expect((await call(env, '/v1/usage', { token })).json.used).toBeLessThanOrEqual(QUOTA)
  })

  test('turns away an image that would not fit', async () => {
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run(OTHER, owner.id, QUOTA, 'image/png', 1)

    const response = await upload(sized(1))
    expect(response.status).toBe(507)
  })
})

describe('a writer who deletes their account', () => {
  test('leaves the paper they gave the owner’s page note, handed to the owner', async () => {
    const owner = await signIn(env, 'owner@b.dev')
    const theirs = (
      await call<{ space: { id: string } }>(env, '/v1/spaces', {
        token: owner,
        body: { name: 'Theirs' },
      })
    ).json.space.id
    const sent = await mail(() =>
      call(env, `/v1/spaces/${theirs}/share/invite`, {
        token: owner,
        body: { email: 'a@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/join/${/\/join\/([a-f0-9]+)/.exec(sent)?.[1]}`, {
      method: 'POST',
      token,
    })
    const lecture = (
      await call<{ note: { id: string } }>(env, `/v1/spaces/${theirs}/notes`, {
        token: owner,
        body: { path: 'Lecture.pages', content: '{}' },
      })
    ).json.note.id
    const pdf = new TextEncoder().encode('%PDF-1.4\nthe lecture\n%%EOF\n')
    const paper = createHash('sha256').update(pdf).digest('hex')
    expect((await upload({ bytes: pdf, hash: paper }, { type: 'application/pdf' })).status).toBe(
      201,
    )
    await call(env, `/v1/notes/${lecture}/paper`, { method: 'PUT', token, body: { hash: paper } })
    expect((await call(env, `/v1/notes/${lecture}/paper`, { token: owner })).status).toBe(200)

    const writer = env.db.prepare("select id, email from users where email = 'a@b.dev'").get() as {
      id: string
      email: string
    }
    const { eraseAccount } = await import('../src/sync-server/src/erase')
    const { sweepLeftovers } = await import('../src/sync-server/src/leftovers')
    await eraseAccount(env, { id: writer.id, email: writer.email, name: null, created_at: 1 })
    await sweepLeftovers(env)

    expect((await call(env, `/v1/notes/${lecture}/paper`, { token: owner })).status).toBe(200)
    const ownerId = env.db.prepare("select id from users where email = 'owner@b.dev'").get() as {
      id: string
    }
    expect(env.db.prepare('select user_id from blobs where hash = ?').all(paper)).toEqual([
      { user_id: ownerId.id },
    ])
  })
})
