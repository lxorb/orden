import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, testEnv, type TestEnv } from './harness'

function assets(): { fetch(request: Request): Promise<Response> } {
  return {
    fetch(request: Request) {
      const path = new URL(request.url).pathname
      const body = path === '/even.html' || path === '/index.html' ? path : '/index.html'
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/html' } }))
    },
  }
}

let env: TestEnv

beforeEach(() => {
  env = testEnv({ ASSETS: assets() })
})

afterEach(() => env.close())

describe('the Even Realities plugin', () => {
  test('is served at /even/ and at /even', async () => {
    expect((await call(env, '/even/')).text).toBe('/even.html')
    expect((await call(env, '/even')).text).toBe('/even.html')
  })

  test('is not what the editor is served as', async () => {
    expect((await call(env, '/')).text).toBe('/index.html')
    expect((await call(env, '/somewhere')).text).toBe('/index.html')
  })

  test('and the editor, unlike the plugin, is no other site’s to frame', async () => {
    for (const path of ['/', '/somewhere']) {
      const page = await call(env, path)
      expect(page.headers.get('content-security-policy'), path).toBe("frame-ancestors 'none'")
      expect(page.headers.get('x-frame-options'), path).toBe('DENY')
    }

    expect((await call(env, '/even/')).headers.get('x-frame-options')).toBe(null)
  })

  test('says so when there is nothing to serve', async () => {
    const bare = testEnv()
    expect((await call(bare, '/even/')).status).toBe(404)
    bare.close()
  })
})
