import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fakeCloudflare, TOKEN, ZONE } from './cloudflare'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string
let cloudflare: ReturnType<typeof fakeCloudflare>

beforeEach(async () => {
  cloudflare = fakeCloudflare()
  cloudflare.install()

  env = testEnv({ CF_API_TOKEN: TOKEN, CF_ZONE_ID: ZONE })
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id
  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Hello.md', content: '# Hello\n' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

async function publish(body: Record<string, unknown>, id = space, as = token) {
  return call(env, `/v1/spaces/${id}/blog`, { method: 'PUT', token: as, body })
}

async function status(id = space, as = token) {
  return call(env, `/v1/spaces/${id}/blog/domain`, { token: as })
}

describe("a domain of one's own", () => {
  test('is asked of Cloudflare, validated over HTTP', async () => {
    await publish({ domain: 'notes.example.com' })

    const hostname = cloudflare.hostnames.get('notes.example.com')
    expect(hostname).toBeDefined()
    expect(hostname!.ssl.method).toBe('http')
    expect(hostname!.ssl.type).toBe('dv')
  })

  test('is pending until the record is in place', async () => {
    await publish({ domain: 'notes.example.com' })

    const response = await status()
    expect(response.status).toBe(200)
    expect(response.json.domain).toBe('notes.example.com')
    expect(response.json.state).toBe('pending')
    expect(response.json.dns).toEqual([
      expect.objectContaining({ type: 'CNAME', name: 'notes.example.com', value: 'cname.nibeditor.com' }),
    ])
  })

  test("relays what Cloudflare is waiting for, without calling it an error", async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.complain('notes.example.com', 'custom hostname does not CNAME to this zone.')

    const response = await status()
    expect(response.json.state).toBe('pending')
    expect(response.json.detail).toBe('custom hostname does not CNAME to this zone.')
  })

  test('is active once the certificate is out', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.activate('notes.example.com')

    expect((await status()).json.state).toBe('active')
  })

  test('is an error once Cloudflare has given up', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.timeOut('notes.example.com')

    const response = await status()
    expect(response.json.state).toBe('error')
    expect(response.json.detail).toBeTruthy()
  })

  test('is an error when the record was taken away again', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.activate('notes.example.com')
    cloudflare.move('notes.example.com')

    expect((await status()).json.state).toBe('error')
  })

  test('is asked for again when Cloudflare has no record of it', async () => {
    // A domain set before certificates were handed out, or while Cloudflare
    // was unreachable, catches up the first time anyone asks after it.
    await publish({ domain: 'notes.example.com' })
    cloudflare.hostnames.clear()

    expect((await status()).json.state).toBe('pending')
    expect(cloudflare.hostnames.has('notes.example.com')).toBe(true)
  })

  test('is not asked for twice', async () => {
    await publish({ domain: 'notes.example.com' })
    await publish({ domain: 'notes.example.com', title: 'Renamed' })
    await status()

    expect(cloudflare.calls.filter((one) => one.startsWith('POST'))).toHaveLength(1)
  })

  test('is released when the space goes back to a shared name', async () => {
    await publish({ domain: 'notes.example.com' })
    await publish({ subdomain: 'field' })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
  })

  test('is released when publishing stops', async () => {
    await publish({ domain: 'notes.example.com' })
    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
    expect((await status()).json.state).toBe('none')
  })

  test('is released when the space is deleted', async () => {
    await publish({ domain: 'notes.example.com' })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
  })

  test('is swapped when the domain changes', async () => {
    await publish({ domain: 'notes.example.com' })
    await publish({ domain: 'blog.example.com' })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
    expect(cloudflare.hostnames.has('blog.example.com')).toBe(true)
  })

  test('cannot be held by two spaces', async () => {
    await publish({ domain: 'notes.example.com' })

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    const response = await publish({ domain: 'notes.example.com' }, theirs.json.space.id, other)

    expect(response.status).toBe(409)
    expect(response.json.error).toBe('that domain is taken')
    expect(cloudflare.hostnames.size).toBe(1)
  })

  test('is recorded even when Cloudflare refuses, and the refusal is reported', async () => {
    // Someone else's zone already holds the hostname, say. The row is the
    // truth; the status is where the trouble shows.
    cloudflare.refuse('notes.example.com', 'The hostname is already on Cloudflare in another zone.')

    const response = await publish({ domain: 'notes.example.com' })
    expect(response.status).toBe(200)
    expect(response.json.space.blog.domain).toBe('notes.example.com')

    const reported = await status()
    expect(reported.json.state).toBe('error')
    expect(reported.json.detail).toBe('The hostname is already on Cloudflare in another zone.')
  })

  test('cannot be the shared domain itself, which is the app', async () => {
    const response = await publish({ domain: 'nibeditor.com' })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('use a domain of your own')
    expect(cloudflare.hostnames.size).toBe(0)
  })

  test('cannot be a name under the shared domain either', async () => {
    expect((await publish({ domain: 'evil.nibeditor.com' })).status).toBe(400)
    expect((await publish({ domain: 'www.nibeditor.com' })).status).toBe(400)
  })

  test('is never served on the shared domain, whatever the row says', async () => {
    // Belt and braces: a row that somehow names the app's own host must not
    // put a blog in front of the app for everyone.
    await publish({ subdomain: 'field' })
    env.db
      .prepare('update spaces set blog_subdomain = null, blog_domain = ? where id = ?')
      .run('nibeditor.com', space)

    const response = await call(env, '/', { host: 'nibeditor.com' })
    expect(response.text).not.toContain('Field notes')
  })

  test('has nothing to report while the space has no domain', async () => {
    await publish({ subdomain: 'field' })

    const response = await status()
    expect(response.json).toEqual({ domain: null, state: 'none', detail: null, dns: [] })
  })

  test('is not reported to anyone but the owner', async () => {
    await publish({ domain: 'notes.example.com' })
    const other = await signIn(env, 'other@b.dev')

    expect((await status(space, other)).status).toBe(404)
  })
})

describe('without Cloudflare access', () => {
  let plain: TestEnv
  let plainToken: string
  let plainSpace: string

  beforeEach(async () => {
    plain = testEnv()
    plainToken = await signIn(plain, 'a@b.dev')
    const created = await call(plain, '/v1/spaces', { token: plainToken, body: { name: 'Local' } })
    plainSpace = created.json.space.id
  })

  afterEach(() => plain.close())

  test('a domain is recorded and nothing goes over the network', async () => {
    const response = await call(plain, `/v1/spaces/${plainSpace}/blog`, {
      method: 'PUT',
      token: plainToken,
      body: { domain: 'notes.example.com' },
    })

    expect(response.status).toBe(200)
    expect(response.json.space.blog.domain).toBe('notes.example.com')
    expect(cloudflare.calls).toEqual([])
  })

  test('the status says so', async () => {
    await call(plain, `/v1/spaces/${plainSpace}/blog`, {
      method: 'PUT',
      token: plainToken,
      body: { domain: 'notes.example.com' },
    })

    const response = await call(plain, `/v1/spaces/${plainSpace}/blog/domain`, { token: plainToken })
    expect(response.json.state).toBe('unconfigured')
    expect(response.json.dns).toHaveLength(1)
  })
})

describe('what to add at the registrar', () => {
  test('a name under a domain gets a CNAME to the shared target', async () => {
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.dns).toEqual([
      expect.objectContaining({ type: 'CNAME', name: 'notes.example.com', value: 'cname.nibeditor.com' }),
    ])
  })

  test('the root of a domain gets the same target and a word about ALIAS records', async () => {
    const response = await publish({ domain: 'example.com' })

    expect(response.json.dns).toHaveLength(1)
    expect(response.json.dns[0].type).toBe('CNAME')
    expect(response.json.dns[0].value).toBe('cname.nibeditor.com')
    expect(response.json.dns[0].note).toMatch(/ALIAS/)
  })

  test('never names a placeholder address', async () => {
    for (const domain of ['example.com', 'notes.example.com']) {
      const response = await publish({ domain })
      expect(JSON.stringify(response.json.dns)).not.toContain('192.0.2.')
    }
  })

  test('the target itself publishes nothing', async () => {
    await publish({ domain: 'notes.example.com' })

    const response = await call(env, '/', { host: 'cname.nibeditor.com' })
    expect(response.status).toBe(302)
  })

  test('a space id is not an address', async () => {
    // It used to be the CNAME target for a space without a name, which is
    // every space on a domain of its own now that no space has both.
    await publish({ domain: 'notes.example.com' })

    const response = await call(env, '/', { host: `${space}.nibeditor.com` })
    expect(response.status).toBe(302)
  })
})

describe('one address, never two', () => {
  const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
  const MIGRATIONS = readdirSync(FOLDER)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const GUARD = MIGRATIONS.find((name) => name.startsWith('0009'))!

  test('the database refuses a row with both', () => {
    expect(() =>
      env.db
        .prepare('update spaces set blog_subdomain = ?, blog_domain = ? where id = ?')
        .run('field', 'notes.example.com', space),
    ).toThrow(/one address/)
  })

  test('the database refuses a new row with both', () => {
    expect(() =>
      env.db
        .prepare(
          `insert into spaces (id, user_id, name, created_at, updated_at, blog_subdomain, blog_domain)
           select 'x', user_id, 'X', 0, 0, 'field', 'notes.example.com' from spaces where id = ?`,
        )
        .run(space),
    ).toThrow(/one address/)
  })

  test('a row that had both keeps the domain once the guard arrives', () => {
    const database = new DatabaseSync(':memory:')
    for (const name of MIGRATIONS.filter((one) => one < GUARD)) {
      database.exec(readFileSync(FOLDER + name, 'utf8'))
    }

    database.exec(`insert into users (id, email, created_at) values ('u', 'a@b.dev', 0)`)
    database.exec(
      `insert into spaces (id, user_id, name, created_at, updated_at, blog_enabled, blog_subdomain, blog_domain)
       values ('both', 'u', 'Both', 0, 0, 1, 'field', 'notes.example.com'),
              ('name', 'u', 'Name', 0, 0, 1, 'other', null),
              ('domain', 'u', 'Domain', 0, 0, 1, null, 'blog.example.com')`,
    )

    database.exec(readFileSync(FOLDER + GUARD, 'utf8'))

    const rows = database
      .prepare('select id, blog_subdomain, blog_domain from spaces order by id')
      .all() as { id: string; blog_subdomain: string | null; blog_domain: string | null }[]

    expect(rows).toEqual([
      { id: 'both', blog_subdomain: null, blog_domain: 'notes.example.com' },
      { id: 'domain', blog_subdomain: null, blog_domain: 'blog.example.com' },
      { id: 'name', blog_subdomain: 'other', blog_domain: null },
    ])
    database.close()
  })

  test('the guard can be applied again without harm', () => {
    expect(() => env.db.exec(readFileSync(FOLDER + GUARD, 'utf8'))).not.toThrow()
    expect(() =>
      env.db
        .prepare('update spaces set blog_subdomain = ?, blog_domain = ? where id = ?')
        .run('field', 'notes.example.com', space),
    ).toThrow(/one address/)
  })
})

describe('names kept off the shared domain', () => {
  async function available(name: string) {
    return (await call(env, `/v1/spaces/available/${name}`, { token })).json.available
  }

  test('names nobody uses are free', async () => {
    for (const name of ['blog', 'docs', 'help', 'support', 'status', 'cdn', 'assets', 'static']) {
      expect(await available(name), name).toBe(true)
    }
    for (const name of ['api', 'app', 'admin', 'nib', 'markdown', 'test', 'staging', 'dev']) {
      expect(await available(name), name).toBe(true)
    }
  })

  test("the site's own name is not", async () => {
    expect(await available('www')).toBe(false)
  })

  test('the mail names are not, because mail records exist', async () => {
    for (const name of ['mail', 'smtp', 'imap']) expect(await available(name), name).toBe(false)
  })

  test('the nameserver names are not', async () => {
    for (const name of ['ns', 'ns1', 'ns2']) expect(await available(name), name).toBe(false)
  })

  test("the CNAME target's own label is not", async () => {
    expect(await available('cname')).toBe(false)
    expect((await publish({ subdomain: 'cname' })).status).toBe(409)
  })
})
