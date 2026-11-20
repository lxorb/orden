import { afterEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

function assets(files: Record<string, string>): { fetch(request: Request): Promise<Response> } {
  return {
    fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname
      const file = path.endsWith('/') ? `${path}index.html` : files[path] !== undefined ? path : `${path}.html`
      const body = files[file]
      if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }))
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'text/javascript'
      return Promise.resolve(new Response(body, { headers: { 'content-type': type } }))
    },
  }
}
const FILES = {
  '/index.html': 'the app',
  '/handoff.html': 'the handoff',
  '/assets/handoff-1a2b.js': 'handoff code',
  '/icon-256.png': 'icon',
  '/sw.js': 'the app worker',
  '/demo/phone.html': 'a demo',
  '/demo/web/kestrel.html': 'a page in the demo',
  '/pass.html': 'pass',
  '/pass-link.html': 'a link',
}
const SITE = 'orden.so'
const APP = 'app.orden.so'
let env: TestEnv
afterEach(() => env.close())
const served = () => (env = testEnv({ ASSETS: assets(FILES) }))
describe('the app under its own name', () => {
  test('is served at app.orden.so, every page of it', async () => {
    served()
    for (const path of ['/', '/join/abc', '/s/some/where', '/pass-link/x']) {
      const page = await call(env, path, { host: APP })
      expect(page.status, path).toBeLessThan(400)
      expect(page.status, path).not.toBe(301)
    }
    expect((await call(env, '/', { host: APP })).text).toBe('the app')
  })
  test('answers the API there too, from the web app across the two names', async () => {
    served()
    const token = await signIn(env, 'a@b.dev')
    for (const host of [APP, SITE]) {
      const me = await call(env, '/v1/me', { host, token, headers: { origin: 'https://app.orden.so' } })
      expect(me.status, host).toBe(200)
      expect(me.headers.get('access-control-allow-origin'), host).toBe('https://app.orden.so')
    }
  })
})
describe('orden.so, the site', () => {
  test('sends every page of the app on to app.orden.so, keeping its path and query', async () => {
    served()
    for (const [path, to] of [
      ['/?x=1', 'https://app.orden.so/?x=1'],
      ['/', 'https://app.orden.so/'],
      ['/join/abc123', 'https://app.orden.so/join/abc123'],
      ['/pass-link/vault-1', 'https://app.orden.so/pass-link/vault-1'],
      ['/some/deep/path?a=b', 'https://app.orden.so/some/deep/path?a=b'],
      ['/?channel=unstable', 'https://app.orden.so/?channel=unstable'],
      ['/_unstable/index.html', 'https://app.orden.so/_unstable/index.html'],
      ['/pass.html', 'https://app.orden.so/pass.html'],
    ]) {
      const moved = await call(env, path ?? '', { host: SITE })
      expect(moved.status, path).toBe(301)
      expect(moved.headers.get('location'), path).toBe(to)
    }
    const posted = await call(env, '/somewhere', { host: SITE, method: 'POST', raw: 'x' })
    expect(posted.status).toBe(308)
  })
  test('keeps answering what released apps, machines and the handoff ask it for', async () => {
    served()
    const token = await signIn(env, 'a@b.dev')
    expect((await call(env, '/v1/me', { host: SITE, token })).status).toBe(200)
    expect((await call(env, '/health', { host: SITE })).status).toBe(200)
    expect((await call(env, '/.well-known/oauth-authorization-server', { host: SITE })).json.issuer).toBe(
      'https://orden.so',
    )
    expect((await call(env, '/.well-known/oauth-authorization-server', { host: APP })).json.issuer).toBe(
      'https://app.orden.so',
    )
    for (const [path, body] of [
      ['/handoff', 'the handoff'],
      ['/assets/handoff-1a2b.js', 'handoff code'],
      ['/icon-256.png', 'icon'],
    ]) {
      const kept = await call(env, path ?? '', { host: SITE })
      expect(kept.status, path).toBe(200)
      expect(kept.text, path).toBe(body)
    }
  })
  test('answers the machines on both names, never with a redirect', async () => {
    served()
    for (const host of [SITE, APP]) {
      for (const path of ['/v2/online/machine/current', `/v2/online/machine/${'a'.repeat(64)}.bin`]) {
        const asked = await call(env, path, { host })
        expect([301, 302, 307, 308], `${host}${path}`).not.toContain(asked.status)
      }
    }
  })
  test('hands an app worker left behind there one that clears and leaves', async () => {
    served()
    const worker = await call(env, '/sw.js', { host: SITE })
    expect(worker.headers.get('content-type')).toBe('text/javascript')
    expect(worker.text).toContain('unregister()')
    expect(worker.text).not.toContain('the app worker')
    expect((await call(env, '/sw.js', { host: APP })).text).toBe('the app worker')
  })
})
describe('a name under orden.so nobody publishes under', () => {
  test('sends the visitor to the site', async () => {
    served()
    const sent = await call(env, '/anything', { host: 'nobody-here.orden.so' })
    expect(sent.status).toBe(302)
    expect(sent.headers.get('location')).toBe('https://orden.so')
  })
})
describe('framing', () => {
  test('a demo page of the app may be framed by the site, and inside the app’s own demo, and by nobody else', async () => {
    served()
    for (const path of ['/?demo', '/?demo=phone', '/demo/phone', '/demo/web/kestrel']) {
      const page = await call(env, path, { host: APP })
      const policy = page.headers.get('content-security-policy') ?? ''
      const ancestors = policy.replace(/^frame-ancestors /, '').split(' ')
      expect(policy, path).toMatch(/^frame-ancestors /)
      expect(ancestors.sort(), path).toEqual(["'self'", 'https://orden.so'])
      expect(page.headers.get('x-frame-options'), path).toBeNull()
    }
  })
  test('a demo page framed by the app’s demo, itself framed by the site, finds every ancestor allowed', async () => {
    served()
    const inner = await call(env, '/demo/web/kestrel', { host: APP })
    const outer = await call(env, '/?demo', { host: APP })
    const allows = (policy: string | null, origin: string) =>
      (policy ?? '')
        .replace(/^frame-ancestors /, '')
        .split(' ')
        .some((one) => one === origin || (one === "'self'" && origin === 'https://app.orden.so'))
    for (const ancestor of ['https://app.orden.so', 'https://orden.so']) {
      expect(allows(inner.headers.get('content-security-policy'), ancestor), ancestor).toBe(true)
    }
    expect(allows(outer.headers.get('content-security-policy'), 'https://orden.so')).toBe(true)
    expect(allows(inner.headers.get('content-security-policy'), 'https://evil.example')).toBe(false)
  })
  test('every other page, and every page on another name, is nobody’s to frame', async () => {
    served()
    for (const [host, path] of [
      [APP, '/'],
      [APP, '/join/abc'],
      [SITE, '/handoff'],
      ['pass.orden.so', '/?demo'],
    ]) {
      const page = await call(env, path ?? '', { host: host ?? '' })
      expect(page.headers.get('content-security-policy'), `${host}${path}`).toBe("frame-ancestors 'none'")
      expect(page.headers.get('x-frame-options'), `${host}${path}`).toBe('DENY')
    }
  })
})
