import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { MOST_SITES, siteOf } from '../src/sync-server-blobs/src/site-icons'

let env: TestEnv
let token: string

let fetched: string[] = []

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  fetched = []
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url)
    if (url.includes('huge')) {
      return Promise.resolve(
        new Response(new Uint8Array(70 * 1024), { headers: { 'content-type': 'image/png' } }),
      )
    }
    if (url.includes('page')) {
      return Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    }
    return Promise.resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

const seen = (body: Record<string, unknown>, as = token) =>
  call(env, '/v2/site-icons', { token: as, body })

async function listed(as = token): Promise<{ site: string; label: string; hash: string | null }[]> {
  return (await call(env, '/v2/site-icons', { token: as })).json.sites
}

describe('the sites an account has been to', () => {
  test('are kept newest first, one row a site, with the mark the service fetched', async () => {
    await seen({
      site: 'github.com',
      label: 'GitHub',
      icon: 'https://github.com/favicon.ico',
      seen: 1,
    })
    await seen({ site: 'www.example.org', icon: 'https://example.org/i.png', seen: 2 })
    await seen({ site: 'github.com', icon: 'https://github.com/favicon.ico', seen: 3 })

    const sites = await listed()
    expect(sites.map((one) => one.site)).toEqual(['github.com', 'example.org'])
    expect(sites[0]?.label).toBe('GitHub')
    expect(sites[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(fetched).toEqual(['https://github.com/favicon.ico', 'https://example.org/i.png'])

    const picture = await call(env, '/v2/site-icons/github.com/picture', { token })
    expect(picture.status).toBe(200)
    expect(picture.text).toBe(new TextDecoder().decode(PNG))
  })

  test('take a mark written inline, and refuse what is not a small picture', async () => {
    const inline = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`
    await seen({ site: 'inline.dev', icon: inline })
    await seen({ site: 'huge.dev', icon: 'https://huge.dev/i.png' })
    await seen({ site: 'page.dev', icon: 'https://page.dev/' })
    await seen({ site: 'local.dev', icon: 'http://127.0.0.1/i.png' })

    const sites = Object.fromEntries((await listed()).map((one) => [one.site, one.hash]))
    expect(sites['inline.dev']).toMatch(/^[a-f0-9]{64}$/)
    expect(sites['huge.dev']).toBeNull()
    expect(sites['page.dev']).toBeNull()
    expect(sites['local.dev']).toBeNull()
    expect(fetched).not.toContain('http://127.0.0.1/i.png')
  })

  test('are only host names', async () => {
    expect((await seen({ site: 'not a site' })).status).toBe(400)
    expect((await seen({ site: 'localhost' })).status).toBe(400)
    expect(siteOf('WWW.GitHub.com')).toBe('github.com')
    expect(siteOf('192.168.0.1')).toBeNull()
  })

  test('are the account s own', async () => {
    await seen({ site: 'github.com', icon: 'https://github.com/favicon.ico' })
    const other = await signIn(env, 'c@d.dev')

    expect(await listed(other)).toEqual([])
    expect((await call(env, '/v2/site-icons/github.com/picture', { token: other })).status).toBe(
      404,
    )
  })

  test('go with the history: those seen since a moment, those named, or all', async () => {
    await seen({ site: 'old.dev', seen: 10 })
    await seen({ site: 'new.dev', seen: 20 })
    await seen({ site: 'named.dev', seen: 30 })

    await call(env, '/v2/site-icons', { token, method: 'DELETE', body: { sites: ['named.dev'] } })
    expect((await listed()).map((one) => one.site)).toEqual(['new.dev', 'old.dev'])

    await call(env, '/v2/site-icons', { token, method: 'DELETE', body: { since: 15 } })
    expect((await listed()).map((one) => one.site)).toEqual(['old.dev'])

    await call(env, '/v2/site-icons', { token, method: 'DELETE', body: {} })
    expect(await listed()).toEqual([])
  })

  test('are bounded, the oldest forgotten', async () => {
    for (let at = 0; at <= MOST_SITES; at++) await seen({ site: `s${at}.dev`, seen: at + 1 })

    const sites = await listed()
    expect(sites).toHaveLength(MOST_SITES)
    expect(sites.map((one) => one.site)).not.toContain('s0.dev')
  })

  test('are nobody s without a session', async () => {
    expect((await call(env, '/v2/site-icons')).status).toBe(401)
  })
})
