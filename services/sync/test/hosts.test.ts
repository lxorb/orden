import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import worker from '../src/index'
import { blogRootOf, blogRoots, isOwnOrigin, originAt, origins } from '../src/hosts'
import { isMachineHost, machineDomain } from '../src/machines/hetzner-host'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

/** The service under both of its names, as wrangler.jsonc sets it up: every
 *  name answers as itself, with the same accounts, tokens and sites behind it.
 *  The harness sets both names up the same way, so the rest of the suite runs
 *  there too; this file is about what differs between the two. */

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.restoreAllMocks()
})

const OLD = 'https://nibeditor.com'
const NEW = 'https://orden.so'
const CALLBACK = 'https://chatgpt.com/connector/oauth/abc123'

describe('the names', () => {
  test('are the one links name, then the others, each once and as an origin', () => {
    const named = testEnv({
      APP_ORIGIN: 'https://Orden.so/',
      OTHER_ORIGINS: ' https://nibeditor.com , https://orden.so,, not a url ',
    })
    expect(origins(named)).toEqual([NEW, OLD])
    named.close()
  })

  test('answer for themselves and for nobody else', () => {
    expect(isOwnOrigin(env, NEW)).toBe(true)
    expect(isOwnOrigin(env, OLD)).toBe(true)
    expect(isOwnOrigin(env, 'http://orden.so')).toBe(false)
    expect(isOwnOrigin(env, 'https://orden.so.evil.example')).toBe(false)
    expect(isOwnOrigin(env, 'null')).toBe(false)
  })

  test('a request is answered in the name it used, or in the one links name', () => {
    expect(originAt(env, 'https://orden.so/.well-known/x')).toBe(NEW)
    expect(originAt(env, 'https://nibeditor.com/oauth/token')).toBe(OLD)
    expect(originAt(env, 'https://notes.example.com/')).toBe(OLD)
  })

  test('every name is a blog root, and the longest one a host is under wins', () => {
    expect(blogRoots(env)).toEqual(['nibeditor.com', 'orden.so'])
    expect(blogRootOf(env, 'field.orden.so')).toBe('orden.so')
    expect(blogRootOf(env, 'orden.so')).toBe('orden.so')
    expect(blogRootOf(env, 'field.nibeditor.com.orden.so')).toBe('orden.so')
    expect(blogRootOf(env, 'notorden.so')).toBeNull()

    const nested = testEnv({ OTHER_BLOG_ROOTS: 'blogs.nibeditor.com' })
    expect(blogRootOf(nested, 'a.blogs.nibeditor.com')).toBe('blogs.nibeditor.com')
    nested.close()
  })
})

describe('the web app under the new name', () => {
  test('may call the API under the old one, and the other way round', async () => {
    for (const host of ['nibeditor.com', 'orden.so']) {
      for (const origin of [OLD, NEW]) {
        const response = await call(env, '/v1/me', { host, headers: { origin } })
        expect(response.headers.get('access-control-allow-origin'), `${origin} at ${host}`).toBe(
          origin,
        )
      }
    }
  })

  test('is signed in under either name with the same session', async () => {
    const token = await signIn(env, 'a@b.dev')
    for (const host of ['nibeditor.com', 'orden.so']) {
      const me = await call(env, '/v1/me', { host, token })
      expect(me.status, host).toBe(200)
      expect(me.json.user.email).toBe('a@b.dev')
    }
  })
})

describe('a published site', () => {
  let token: string
  let space: string

  beforeEach(async () => {
    token = await signIn(env, 'a@b.dev')
    space = (await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })).json.space.id
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Hello world.md', content: '# Hello world\n\nFirst **post**.\n' },
    })
  })

  test('is the same site under both names', async () => {
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })

    const old = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    const now = await call(env, '/hello-world', { host: 'field.orden.so' })
    expect(old.status).toBe(200)
    expect(now.status).toBe(200)
    expect((await call(env, '/hello-world', { host: 'Field.Orden.so.' })).status).toBe(200)
    expect(now.text).toContain('First <strong>post</strong>')
    // Each answers in its own name, so a link copied from either stays on it.
    expect(old.text).toContain('https://field.nibeditor.com/hello-world')
    expect(now.text).toContain('https://field.orden.so/hello-world')
  })

  test('a name nobody publishes under sends the visitor to the app', async () => {
    const response = await call(env, '/some/note', { host: 'unused.orden.so' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(OLD)
  })

  test('the new name itself is the app, not a site', async () => {
    const response = await call(env, '/', { host: 'orden.so' })
    expect(response.status).not.toBe(302)
    expect(response.text).not.toContain('Field notes')
  })

  test('cannot take the new name, or a name under it, as a domain of its own', async () => {
    for (const domain of ['orden.so', 'www.orden.so', 'EVIL.ORDEN.SO.']) {
      const response = await call(env, `/v1/spaces/${space}/blog`, {
        method: 'PUT',
        token,
        body: { domain },
      })
      expect(response.status, domain).toBe(400)
    }
  })

  test('cannot be called after the new name', async () => {
    const response = await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'orden' },
    })
    expect(response.status).toBe(409)
  })
})

/** PKCE, as a client does it. */
async function pkce() {
  const verifier = 'v'.repeat(20) + Math.random().toString(36).slice(2).padEnd(30, 'x')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return { verifier, challenge }
}

/** The emailed code, out of the logging mailer. */
async function codeSentTo(action: () => Promise<unknown>): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })
  await action()
  spy.mockRestore()
  const match = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!match) throw new Error('no code was sent')
  return `${match[1]}${match[2]}`
}

const form = (fields: Record<string, string>) => ({
  raw: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
})

describe('a connector', () => {
  test('finds the server in the name it was given', async () => {
    for (const [host, origin] of [
      ['orden.so', NEW],
      ['nibeditor.com', OLD],
    ] as const) {
      const server = await call(env, '/.well-known/oauth-authorization-server', { host })
      expect(server.json.issuer).toBe(origin)
      expect(server.json.token_endpoint).toBe(`${origin}/oauth/token`)

      const resource = await call(env, '/.well-known/oauth-protected-resource/mcp', { host })
      expect(resource.json.resource).toBe(`${origin}/mcp`)
      expect(resource.json.authorization_servers).toEqual([origin])

      const refused = await call(env, '/mcp', { host, body: { jsonrpc: '2.0', id: 1 } })
      expect(refused.status).toBe(401)
      expect(refused.headers.get('www-authenticate')).toContain(
        `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      )
    }
  })

  test('added under the old name connects through the new one, and the token works under both', async () => {
    const registered = await call(env, '/oauth/register', {
      host: 'orden.so',
      body: {
        client_name: 'ChatGPT',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
      },
    })
    const { verifier, challenge } = await pkce()
    const ask = {
      client_id: registered.json.client_id,
      redirect_uri: CALLBACK,
      state: 'xyz',
      code_challenge: challenge,
      // The resource it was told about when it was added, before the rename.
      resource: `${OLD}/mcp`,
    }

    const code = await codeSentTo(() =>
      call(env, '/oauth/authorize', {
        host: 'orden.so',
        ...form({ ...ask, action: 'send', email: 'a@b.dev' }),
      }),
    )
    const allowed = await call(env, '/oauth/authorize', {
      host: 'orden.so',
      ...form({ ...ask, action: 'allow', email: 'a@b.dev', code }),
    })
    expect(allowed.status).toBe(302)
    const sentTo = new URL(allowed.headers.get('location')!)
    expect(sentTo.searchParams.get('iss')).toBe(NEW)

    const tokens = await call(env, '/oauth/token', {
      host: 'orden.so',
      ...form({
        grant_type: 'authorization_code',
        code: sentTo.searchParams.get('code')!,
        code_verifier: verifier,
        client_id: registered.json.client_id,
        redirect_uri: CALLBACK,
        resource: `${OLD}/mcp`,
      }),
    })
    expect(tokens.status).toBe(200)

    for (const host of ['orden.so', 'nibeditor.com']) {
      const listed = await call<RpcView>(env, '/mcp', {
        host,
        token: tokens.json.access_token,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      })
      expect(listed.status, host).toBe(200)
    }
  })

  test('asking for a resource that is neither name is refused', async () => {
    const registered = await call(env, '/oauth/register', {
      host: 'orden.so',
      body: { client_name: 'X', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' },
    })
    const { challenge } = await pkce()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registered.json.client_id,
      redirect_uri: CALLBACK,
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: 'https://orden.so.evil.example/mcp',
    })

    const response = await call(env, `/oauth/authorize?${query.toString()}`, { host: 'orden.so' })
    const sentTo = new URL(response.headers.get('location')!)
    expect(sentTo.searchParams.get('error')).toBe('invalid_target')
    expect(sentTo.searchParams.get('iss')).toBe(NEW)
  })
})

describe('a machine', () => {
  const HEX = '0123456789abcdef0123456789abcdef'

  test('keeps its hostname under the zone its records are in when the links move', async () => {
    const moved = testEnv({
      APP_ORIGIN: NEW,
      OTHER_ORIGINS: OLD,
      BLOG_ROOT: 'orden.so',
      OTHER_BLOG_ROOTS: 'nibeditor.com',
    })
    expect(machineDomain(moved)).toBe('nibeditor.com')
    expect(isMachineHost(`m-${HEX}.nibeditor.com`, machineDomain(moved))).toBe(true)
    expect(isMachineHost(`m-${HEX}.orden.so`, machineDomain(moved))).toBe(false)

    // Unset, it is wherever the links are, which is what a test or a local
    // Worker with one name means.
    const single = testEnv({ APP_ORIGIN: NEW })
    delete single.MACHINE_DOMAIN
    expect(machineDomain(single)).toBe('orden.so')

    // And a request for a machine's name goes on to the machine, not the app.
    const outward = vi.fn(() => Promise.resolve(new Response('nibd')))
    vi.stubGlobal('fetch', outward)
    const answer = await worker.fetch(new Request(`https://m-${HEX}.nibeditor.com/link`), moved)
    expect(await answer.text()).toBe('nibd')
    expect(outward).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()

    moved.close()
    single.close()
  })
})
