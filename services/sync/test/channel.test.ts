import { afterEach, describe, expect, test } from 'vitest'
import { serveApp, switchChannel } from '../src/channel'
import { call, signIn, testEnv, type TestEnv } from './harness'

function assets(files: Record<string, string>): { fetch(request: Request): Promise<Response> } {
  const binding = {
    fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path.endsWith('.html') && files[path] !== undefined) {
        const to = path.endsWith('/index.html')
          ? path.slice(0, -'index.html'.length)
          : path.slice(0, -5)
        if (request.redirect === 'follow')
          return binding.fetch(new Request(new URL(to, request.url)))
        return Promise.resolve(new Response(null, { status: 307, headers: { location: to } }))
      }
      const file = path.endsWith('/')
        ? `${path}index.html`
        : files[path] !== undefined
          ? path
          : `${path}.html`
      const body = files[file]
      if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }))
      const type = file.endsWith('.html') ? 'text/html' : 'text/javascript'
      return Promise.resolve(new Response(body, { headers: { 'content-type': type } }))
    },
  }
  return binding
}

const BOTH = {
  '/index.html': 'stable index',
  '/handoff.html': 'stable handoff',
  '/even.html': 'stable even',
  '/sw.js': 'stable sw',
  '/_unstable/index.html': 'unstable index',
  '/_unstable/handoff.html': 'unstable handoff',
  '/_unstable/even.html': 'unstable even',
  '/_unstable/sw.js': 'unstable sw',
}

const ON_EDGE = { cookie: 'theme=dark; orden-channel=unstable' }

let env: TestEnv

afterEach(() => env.close())

describe('without the cookie', () => {
  test('the release is served, as before', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    expect((await call(env, '/')).text).toBe('stable index')
    expect((await call(env, '/handoff')).text).toBe('stable handoff')
    expect((await call(env, '/sw.js')).text).toBe('stable sw')
    expect((await call(env, '/even/')).text).toBe('stable even')
    expect((await call(env, '/s/some/where')).text).toBe('stable index')
  })

  test('a cookie with any other value is the release too', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const page = await call(env, '/', { headers: { cookie: 'orden-channel=stable' } })
    expect(page.text).toBe('stable index')
  })
})

describe('with the cookie', () => {
  test('the edge is served for every page and every file of its own', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    expect((await call(env, '/', { headers: ON_EDGE })).text).toBe('unstable index')
    expect((await call(env, '/handoff', { headers: ON_EDGE })).text).toBe('unstable handoff')
    expect((await call(env, '/sw.js', { headers: ON_EDGE })).text).toBe('unstable sw')
    expect((await call(env, '/even/', { headers: ON_EDGE })).text).toBe('unstable even')
    expect((await call(env, '/s/some/where', { headers: ON_EDGE })).text).toBe('unstable index')
  })

  test('and is still no other site’s to frame, and says it depends on the cookie', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const page = await call(env, '/', { headers: ON_EDGE })
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('vary')).toContain('cookie')
  })

  test('a redirect the binding makes points where the browser asked', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const asked = new Request('https://orden.so/handoff.html', {
      headers: ON_EDGE,
      redirect: 'manual',
    })
    const page = await serveApp(assets(BOTH), asked)
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('/handoff')
  })

  test('falls back to the release when the edge was not deployed', async () => {
    const stable = Object.fromEntries(
      Object.entries(BOTH).filter(([path]) => !path.startsWith('/_unstable/')),
    )
    env = testEnv({ ASSETS: assets(stable) })
    expect((await call(env, '/', { headers: ON_EDGE })).text).toBe('stable index')
    expect((await call(env, '/s/where', { headers: ON_EDGE })).text).toBe('stable index')
    expect((await call(env, '/even/', { headers: ON_EDGE })).text).toBe('stable even')
  })
})

describe('the folder itself', () => {
  test('is not served by its own address', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    expect((await call(env, '/_unstable/')).status).toBe(404)
    expect((await call(env, '/_unstable/sw.js', { headers: ON_EDGE })).status).toBe(404)
    expect((await call(env, '/_unstable')).status).toBe(404)
  })
})

describe('a cookie another site set for the root', () => {
  test('does not choose the build for a browser that chose one', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    for (const cookie of [
      'orden-channel=unstable; __Host-orden-channel=stable',
      '__Host-orden-channel=stable; orden-channel=unstable',
    ]) {
      expect((await call(env, '/', { headers: { cookie } })).text, cookie).toBe('stable index')
    }
    const chosen = { cookie: 'orden-channel=; __Host-orden-channel=unstable' }
    expect((await call(env, '/', { headers: chosen })).text).toBe('unstable index')
  })

  test('and a browser that chose before the rename stays where it is', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    expect((await call(env, '/', { headers: ON_EDGE })).text).toBe('unstable index')
  })
})

describe('?channel=', () => {
  test('unstable sets the cookie and comes back to the same page without it', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/s/x?a=1&channel=unstable')
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe('/s/x?a=1')
    const cookie = answer.headers.getSetCookie()[0] ?? ''
    expect(cookie).toMatch(
      /^__Host-orden-channel=unstable; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/,
    )
    expect(cookie).not.toMatch(/HttpOnly/i)
  })

  test('stable says so, and clears the one a browser chose before the rename', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/?channel=stable', { headers: ON_EDGE })
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe('/')
    const cookies = answer.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toMatch(/^__Host-orden-channel=stable; Path=\/; Max-Age=\d+;.* Secure$/)
    expect(cookies[1]).toMatch(/^orden-channel=; Path=\/; Max-Age=0;/)
  })

  test('over plain http, keeps the name a browser takes there', () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const edge = switchChannel(new Request('http://localhost:8787/?channel=unstable'))
    expect(edge?.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^orden-channel=unstable; Path=\/; Max-Age=\d+; SameSite=Lax$/),
    ])
    const release = switchChannel(new Request('http://localhost:8787/?channel=stable'))
    expect(release?.headers.getSetCookie()).toEqual([
      'orden-channel=; Path=/; Max-Age=0; SameSite=Lax',
    ])
  })

  test('anything else is just a parameter', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/?channel=nightly')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('set-cookie')).toBe(null)
  })

  test('the API does not answer to it', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/health?channel=unstable')
    expect(answer.json).toEqual({ ok: true })
    expect(answer.headers.get('set-cookie')).toBe(null)
  })

  test('a path that begins with two slashes stays on this site', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    for (const path of ['//evil.example/x', '/\\evil.example/x']) {
      const answer = await call(env, `${path}?channel=stable`)
      expect(answer.status).toBe(302)
      expect(answer.headers.get('location'), path).toBe('/evil.example/x')
    }
  })
})

describe('Pass under its own name', () => {
  const PASS = {
    ...BOTH,
    '/pass.html': 'stable pass',
    '/pass.webmanifest': 'stable pass manifest',
    '/_unstable/pass.html': 'unstable pass',
  }
  const host = 'pass.orden.so'

  test('is Pass at every page, and the app nowhere', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    for (const path of ['/', '/index.html', '/s/some/where', '/handoff']) {
      const page = await call(env, path, { host })
      expect(page.text, path).toBe('stable pass')
    }
    expect((await call(env, '/', { host: 'Pass.Orden.so.' })).text).toBe('stable pass')
    expect((await call(env, '/')).text).toBe('stable index')
    expect((await call(env, '/', { host: 'orden.so' })).text).toBe('stable index')
  })

  test('serves its own files as they are', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    expect((await call(env, '/pass.webmanifest', { host })).text).toBe('stable pass manifest')
    expect((await call(env, '/sw.js', { host })).text).toBe('stable sw')
  })

  test('follows the channel the browser chose', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    expect((await call(env, '/', { host, headers: ON_EDGE })).text).toBe('unstable pass')
    const answer = await call(env, '/?channel=unstable', { host })
    expect(answer.status).toBe(302)
  })

  test('is no other site’s to frame', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    const page = await call(env, '/', { host })
    expect(page.headers.get('x-frame-options')).toBe('DENY')
  })

  test('is not a site somebody published under the same name', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    const token = await signIn(env, 'a@b.dev')
    const space = (await call(env, '/v1/spaces', { token, body: { name: 'Taken' } })).json.space.id
    env.db
      .prepare('update spaces set blog_subdomain = ?, blog_enabled = 1 where id = ?')
      .run('pass', space)
    expect((await call(env, '/', { host })).text).toBe('stable pass')
  })

  test('answers the API it calls', async () => {
    env = testEnv({ ASSETS: assets(PASS) })
    expect((await call(env, '/health', { host })).json).toEqual({ ok: true })
  })

  test('is only there when it has a name', async () => {
    env = testEnv({ ASSETS: assets(PASS), PASS_ORIGIN: '' })
    const page = await call(env, '/', { host })
    expect(page.status).toBe(302)
  })
})
