import { afterEach, describe, expect, test } from 'vitest'
import { serveApp } from '../src/channel'
import { call, testEnv, type TestEnv } from './harness'

/** The web serves two builds from one Worker: the release at the root and the edge of
 *  `unstable` under `/_unstable/`, picked per browser by a cookie. See src/channel.ts
 *  and #424. */

/** The assets binding as the deploy configures it: no not-found page, a page asked
 *  for without `.html` found by its file, and `.html` redirected away - which the
 *  binding follows itself unless the request says `redirect: 'manual'`, as one that
 *  came in from a browser does. */
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
    // A route of the app's own, which no file is: the release's page.
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

describe('?channel=', () => {
  test('unstable sets the cookie and comes back to the same page without it', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/s/x?a=1&channel=unstable')
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe('/s/x?a=1')
    const cookie = answer.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^orden-channel=unstable; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/)
    // The page reads it to say which build it is.
    expect(cookie).not.toMatch(/HttpOnly/i)
  })

  test('stable clears it', async () => {
    env = testEnv({ ASSETS: assets(BOTH) })
    const answer = await call(env, '/?channel=stable', { headers: ON_EDGE })
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe('/')
    expect(answer.headers.get('set-cookie')).toMatch(/^orden-channel=; Path=\/; Max-Age=0;/)
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
})
