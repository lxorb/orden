import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, testEnv, type TestEnv } from './harness'

/** The theme store's catalogue, proxied from the registry.
 *
 *  Nothing here is behind the session and nothing here touches the database.
 *  What matters is that the app can read it from anywhere, that the edge is told
 *  to hold on to it, and that an id can never become a path into the registry. */

let env: TestEnv

/** What the registry was asked for, and what it answered. */
let asked: string[] = []

function registry(answer: (url: string) => Response) {
  asked = []
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)
    return Promise.resolve(answer(url))
  })
}

const RAW = 'https://raw.githubusercontent.com/lxorb/nib-themes/main'

beforeEach(() => {
  env = testEnv()
  registry(() => new Response('{"themes":[]}', { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

describe('the catalogue', () => {
  test('comes from the registry, whatever the app asked', async () => {
    const answer = await call(env, '/themes/index.json')

    expect(answer.status).toBe(200)
    expect(answer.text).toBe('{"themes":[]}')
    expect(asked).toEqual([`${RAW}/index.json`])
  })

  test('is json, cached at the edge for longer than in the reader', async () => {
    const answer = await call(env, '/themes/index.json')
    const cache = answer.headers.get('cache-control') ?? ''

    expect(answer.headers.get('content-type')).toContain('application/json')
    expect(cache).toContain('max-age=300')
    expect(cache).toContain('s-maxage=3600')
    expect(cache).toContain('public')
  })

  test('is open to every origin, being public and read-only', async () => {
    const answer = await call(env, '/themes/index.json', {
      headers: { origin: 'tauri://localhost' },
    })

    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('answers the question a browser asks before it fetches', async () => {
    const answer = await call(env, '/themes/index.json', { method: 'OPTIONS' })

    expect(answer.status).toBe(204)
    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
    expect(answer.headers.get('access-control-allow-methods')).toContain('GET')
  })

  test('a registry that will not answer is a bad gateway and not an empty store', async () => {
    registry(() => new Response('not found', { status: 404 }))

    const answer = await call(env, '/themes/index.json')

    expect(answer.status).toBe(502)
    expect(answer.json.error).toBe('the theme store is not answering')
  })

  test('says so where the app can read it when it goes wrong', async () => {
    // The desktop app is not on this origin, so a body without the header is a
    // body it is not allowed to look at: the reader would be shown whatever the
    // browser says about a failed request instead of the sentence written here.
    registry(() => new Response('nope', { status: 500 }))

    const answer = await call(env, '/themes/index.json', {
      headers: { origin: 'tauri://localhost' },
    })

    expect(answer.status).toBe(502)
    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('refuses to hand on something far too big to be a catalogue', async () => {
    registry(() => new Response('x'.repeat(600 * 1024), { status: 200 }))

    expect((await call(env, '/themes/index.json')).status).toBe(502)
  })
})

describe('a theme stylesheet', () => {
  beforeEach(() => {
    registry(() => new Response(`[data-theme='dark'] { --bg: #000; }`, { status: 200 }))
  })

  test('comes from the folder that theme has in the registry', async () => {
    const answer = await call(env, '/themes/warm-paper/theme.css')

    expect(answer.status).toBe(200)
    expect(answer.text).toContain('--bg: #000;')
    expect(asked).toEqual([`${RAW}/themes/warm-paper/theme.css`])
    expect(answer.headers.get('content-type')).toContain('text/css')
  })

  test('is cached like the catalogue and open like it', async () => {
    const answer = await call(env, '/themes/mono/theme.css')

    expect(answer.headers.get('cache-control')).toContain('s-maxage=3600')
    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('a theme the registry does not have is not found', async () => {
    registry(() => new Response('404: Not Found', { status: 404 }))

    const answer = await call(env, '/themes/nothing/theme.css')

    expect(answer.status).toBe(404)
    expect(answer.json.error).toBe('no such theme')
  })

  test('an id that is not one never reaches the registry', async () => {
    for (const id of ['Warm-Paper', 'a_b', 'a b', '-a', 'a'.repeat(40)]) {
      const answer = await call(env, `/themes/${id}/theme.css`)

      expect(answer.status, id).toBe(400)
      expect(answer.json.error, id).toBe('that is not a theme')
      expect(answer.headers.get('access-control-allow-origin'), id).toBe('*')
    }

    expect(asked).toEqual([])
  })

  /** A theme is text and nothing here is ever big, so a registry answering with
   *  something enormous is turned down. Turned down before it is held: reading it
   *  whole and measuring afterwards is how a Worker with a hundred and twenty-eight
   *  megabytes of memory is asked to hold more than that. */
  test('a stylesheet larger than a stylesheet is turned down', async () => {
    registry(
      () =>
        new Response('a'.repeat(600 * 1024), {
          status: 200,
          headers: { 'content-length': String(600 * 1024) },
        }),
    )

    const answer = await call(env, '/themes/huge/theme.css')
    expect(answer.status).toBe(404)
  })

  test('an id that tries to be a path is not a theme route at all', async () => {
    // Hono matches one segment, so a path never arrives here as an id. Checked
    // anyway, because what comes back must not be a file from the repository.
    for (const path of ['/themes/../../secret/theme.css', '/themes/a/b/theme.css']) {
      const answer = await call(env, path)

      expect(answer.status, path).not.toBe(200)
    }

    expect(asked).toEqual([])
  })
})
