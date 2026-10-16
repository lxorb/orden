import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readSpaceFiles } from '../src/spaces/files'
import { call, mail, signIn, testEnv, type ShareView, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

/** A hash is 64 hex characters; what is behind it never matters here. */
const PAPER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id
})

afterEach(() => env.close())

/** The bytes of a PDF, the way the app sends them up before recording where the
 *  file sits. */
function upload(hash: string, bytes = 2048, type = 'application/pdf') {
  return call(env, `/v1/blobs/${hash}`, {
    method: 'PUT',
    token,
    raw: new Uint8Array(bytes),
    headers: { 'content-type': type },
  })
}

function record(files: { path: string; hash: string }[], as = token) {
  return call(env, `/v1/spaces/${space}/files`, { method: 'PUT', token: as, body: { files } })
}

/** The column itself, which no route hands back whole. */
function column(): string {
  const row = env.db.prepare('select files from spaces where id = ?').get(space) as {
    files: string
  }
  return row.files
}

describe('a PDF as a blob', () => {
  test('is stored like a picture is', async () => {
    const response = await upload(PAPER)

    expect(response.status).toBe(201)
    expect(response.json.stored).toBe(true)
  })

  test('and served back with its own type, where a page publishes it', async () => {
    await upload(PAPER)
    await record([{ path: 'reading/paper.pdf', hash: PAPER }])
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })

    const response = await call(env, `/i/${PAPER}.pdf`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    // Whatever the bytes look like, they are read as what was accepted.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  /** A picture is a capability and a document is not; see the header of
   *  src/blobs.ts, which is where the reasoning lives. */
  test('and not served at all while it is nobody’s published file', async () => {
    await upload(PAPER)
    expect((await call(env, `/i/${PAPER}.pdf`)).status).toBe(404)

    // Recorded in a space that publishes nothing is still nobody's page.
    await record([{ path: 'reading/paper.pdf', hash: PAPER }])
    expect((await call(env, `/i/${PAPER}.pdf`)).status).toBe(404)
  })

  test('and stops being served when the space stops publishing', async () => {
    await upload(PAPER)
    await record([{ path: 'paper.pdf', hash: PAPER }])
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })
    expect((await call(env, `/i/${PAPER}.pdf`)).status).toBe(200)

    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })
    expect((await call(env, `/i/${PAPER}.pdf`)).status).toBe(404)
  })

  test('while a picture is served to whoever holds its hash, as it always was', async () => {
    await upload(PAPER, 64, 'image/png')

    const response = await call(env, `/i/${PAPER}.png`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  test('with the parameters after the type left off', async () => {
    expect((await upload(PAPER, 64, 'application/pdf; charset=binary')).status).toBe(201)
  })

  test('up to a size a whole scanned paper fits in', async () => {
    const response = await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(8),
      headers: { 'content-type': 'application/pdf', 'content-length': String(48 * 1024 * 1024) },
    })

    expect(response.status).toBe(201)
  })

  test('and no further, so one file cannot exhaust the worker', async () => {
    const response = await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(8),
      headers: { 'content-type': 'application/pdf', 'content-length': String(96 * 1024 * 1024) },
    })

    expect(response.status).toBe(413)
  })

  test('while a picture keeps the smaller limit it had', async () => {
    const response = await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(8),
      headers: { 'content-type': 'image/png', 'content-length': String(48 * 1024 * 1024) },
    })

    expect(response.status).toBe(413)
  })

  test('and nothing else is stored at all', async () => {
    expect((await upload(PAPER, 32, 'application/zip')).status).toBe(415)
    expect((await upload(PAPER, 32, 'text/html')).status).toBe(415)
  })
})

describe('what a space keeps beside its notes', () => {
  test('is recorded once the bytes are there', async () => {
    await upload(PAPER)
    const response = await record([{ path: 'reading/paper.pdf', hash: PAPER }])

    expect(response.status).toBe(200)
    expect(response.json.files).toEqual([{ path: 'reading/paper.pdf', hash: PAPER }])
    expect(response.json.missing).toEqual([])
  })

  test('says which bytes are missing rather than taking a row on trust', async () => {
    const response = await record([{ path: 'reading/paper.pdf', hash: PAPER }])

    expect(response.json.files).toEqual([])
    expect(response.json.missing).toEqual([PAPER])
  })

  test('is written whole, so a file that has gone stops being kept', async () => {
    await upload(PAPER)
    await record([{ path: 'reading/paper.pdf', hash: PAPER }])
    await record([])

    expect(readSpaceFiles(column())).toEqual([])
  })

  test('holds a hash in the case the blobs are named in', async () => {
    await upload(PAPER)
    await record([{ path: 'paper.pdf', hash: PAPER.toUpperCase() }])

    expect(readSpaceFiles(column())).toEqual([{ path: 'paper.pdf', hash: PAPER }])
  })

  test('refuses a path that is not one inside the space', async () => {
    await upload(PAPER)

    for (const path of ['/etc/paper.pdf', '../paper.pdf', 'a/../../paper.pdf', 'a\\paper.pdf']) {
      expect((await record([{ path, hash: PAPER }])).status).toBe(400)
    }
  })

  test('refuses anything that is not a PDF, since nothing else is served', async () => {
    await upload(PAPER)

    expect((await record([{ path: 'shot.png', hash: PAPER }])).status).toBe(400)
    expect((await record([{ path: 'paper', hash: PAPER }])).status).toBe(400)
  })

  test('refuses a hash that is not one', async () => {
    expect((await record([{ path: 'paper.pdf', hash: 'nope' }])).status).toBe(400)
  })

  test('refuses a list that is not a list', async () => {
    const response = await call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token,
      body: { files: 'paper.pdf' },
    })

    expect(response.status).toBe(400)
  })

  test('belongs to the account that owns the space', async () => {
    const other = await signIn(env, 'other@b.dev')
    await upload(PAPER)

    expect((await record([{ path: 'paper.pdf', hash: PAPER }], other)).status).toBe(404)
  })

  test('keeps nothing another account holds the bytes for', async () => {
    const other = await signIn(env, 'other@b.dev')
    await call(env, `/v1/blobs/${OTHER}`, {
      method: 'PUT',
      token: other,
      raw: new Uint8Array(16),
      headers: { 'content-type': 'application/pdf' },
    })

    const response = await record([{ path: 'paper.pdf', hash: OTHER }])
    expect(response.json.files).toEqual([])
    expect(response.json.missing).toEqual([OTHER])
  })
})

describe('a space two people write in', () => {
  const THIRD = 'c'.repeat(64)

  /** Somebody the owner gave the space to and who is in it, and their session. */
  async function writerIn(email: string): Promise<string> {
    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token,
        body: { email, role: 'write' },
      }),
    )

    const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
    if (!link) throw new Error(`no invitation was sent:\n${sent}`)

    const session = await signIn(env, email)
    await call(env, `/v1/join/${link}`, { method: 'POST', token: session })
    return session
  }

  /** Somebody with no account, let in by the space's own link. */
  async function guestIn(): Promise<string> {
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'write', mode: 'open' },
    })

    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1]
    if (!link) throw new Error('no link was made')

    return (await call(env, `/v1/join/${link}`, { method: 'POST', body: { device: 'Windows' } }))
      .json.token
  }

  /** A PDF this session's account keeps the bytes of, recorded in the space. */
  async function put(hash: string, as: string, path: string) {
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token: as,
      raw: new Uint8Array(64),
      headers: { 'content-type': 'application/pdf' },
    })
    const held = readSpaceFiles(column())
    return record([...held, { path, hash }], as)
  }

  test('keeps the entries of the person who is not writing the list', async () => {
    const writer = await writerIn('writer@b.dev')
    await put(PAPER, token, 'owner.pdf')
    await put(OTHER, writer, 'writer.pdf')

    // The writer's own client knows about its own paper and nothing else, so
    // that is the whole list it states.
    const response = await record([{ path: 'writer.pdf', hash: OTHER }], writer)

    expect(readSpaceFiles(column())).toEqual([
      { path: 'writer.pdf', hash: OTHER },
      { path: 'owner.pdf', hash: PAPER },
    ])
    expect(response.json.files).toHaveLength(2)
  })

  test('and keeps them when the list is empty', async () => {
    const writer = await writerIn('writer@b.dev')
    await put(PAPER, token, 'owner.pdf')
    await put(OTHER, writer, 'writer.pdf')

    await record([], writer)

    // Their own paper is theirs to take away; the owner's is not.
    expect(readSpaceFiles(column())).toEqual([{ path: 'owner.pdf', hash: PAPER }])
  })

  test('lets a list take over the place another entry sat in', async () => {
    const writer = await writerIn('writer@b.dev')
    await put(PAPER, token, 'paper.pdf')
    await call(env, `/v1/blobs/${THIRD}`, {
      method: 'PUT',
      token: writer,
      raw: new Uint8Array(32),
      headers: { 'content-type': 'application/pdf' },
    })

    await record([{ path: 'paper.pdf', hash: THIRD }], writer)

    expect(readSpaceFiles(column())).toEqual([{ path: 'paper.pdf', hash: THIRD }])
  })

  /** The script a site is dressed in runs on every page of it, and the pages are
   *  the owner's; see the reasoning in src/spaces/files.ts. */
  test('and does not let a writer dress the owner’s site', async () => {
    const writer = await writerIn('writer@b.dev')
    await call(env, `/v1/blobs/${THIRD}`, {
      method: 'PUT',
      token: writer,
      raw: new Uint8Array(32),
      headers: { 'content-type': 'text/javascript' },
    })

    await record([{ path: 'publish.js', hash: THIRD }], writer)
    expect(readSpaceFiles(column())).toEqual([])

    // Nor over one the owner put there.
    await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(32),
      headers: { 'content-type': 'text/javascript' },
    })
    await record([{ path: 'publish.js', hash: PAPER }])
    await record([{ path: 'publish.js', hash: THIRD }], writer)

    expect(readSpaceFiles(column())).toEqual([{ path: 'publish.js', hash: PAPER }])
  })

  test('while the owner dresses their own site', async () => {
    await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(32),
      headers: { 'content-type': 'text/css' },
    })

    await record([{ path: 'publish.css', hash: PAPER }])
    expect(readSpaceFiles(column())).toEqual([{ path: 'publish.css', hash: PAPER }])
  })

  test('drops nothing at all for a guest, who keeps no bytes anywhere', async () => {
    await put(PAPER, token, 'owner.pdf')
    const guest = await guestIn()

    await record([], guest)

    expect(readSpaceFiles(column())).toEqual([{ path: 'owner.pdf', hash: PAPER }])
  })
})

describe('reading the column back', () => {
  test('leaves out anything in it that is not a file', () => {
    const raw = JSON.stringify([
      { path: 'paper.pdf', hash: PAPER },
      { path: 'shot.png', hash: PAPER },
      { path: '../out.pdf', hash: PAPER },
      { path: 'paper.pdf' },
      'nonsense',
    ])

    expect(readSpaceFiles(raw)).toEqual([{ path: 'paper.pdf', hash: PAPER }])
  })

  test('reads nothing at all as nothing', () => {
    expect(readSpaceFiles('')).toEqual([])
    expect(readSpaceFiles('[]')).toEqual([])
    expect(readSpaceFiles('{"files":[]}')).toEqual([])
  })
})
