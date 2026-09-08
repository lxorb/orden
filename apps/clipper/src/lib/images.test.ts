import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, BASE } from './api'
import { belongsTo, uploaded } from './images'

const PAGE = 'https://site.example/article'

interface Fetched {
  url: string
  credentials: string | undefined
}

const fetched: Fetched[] = []

/** An image server that answers with one pixel of whatever type is asked for,
 *  and writes down how it was asked. */
function serving(type: string | null, bytes = 4, status = 200) {
  vi.stubGlobal('fetch', (url: string, options: RequestInit = {}) => {
    fetched.push({ url, credentials: options.credentials })

    // The blob route, answering that it stored what it was given.
    if (url.startsWith(`${BASE}/v1/blobs/`)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"stored":true}'),
      })
    }

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name === 'content-type' ? type : null) },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetched.length = 0
})

describe('whether a picture is the site’s own', () => {
  test('is the page’s own host', () => {
    expect(belongsTo('https://site.example/a.png', PAGE)).toBe(true)
  })

  test('is a host under it, which is where an image server usually sits', () => {
    expect(belongsTo('https://images.site.example/a.png', PAGE)).toBe(true)
  })

  test('is the site above a page served from a subdomain', () => {
    expect(belongsTo('https://site.example/a.png', 'https://blog.site.example/a')).toBe(true)
  })

  test('is not a third party, however much of the name it shares', () => {
    expect(belongsTo('https://other.example/a.png', PAGE)).toBe(false)
    expect(belongsTo('https://site.example.evil.test/a.png', PAGE)).toBe(false)
    expect(belongsTo('https://notsite.example/a.png', PAGE)).toBe(false)
  })

  test('is not anything that is not an address', () => {
    expect(belongsTo('data:image/png;base64,AAAA', PAGE)).toBe(false)
    expect(belongsTo('https://site.example/a.png', 'not an address')).toBe(false)
  })
})

describe('moving the pictures onto the account', () => {
  test('sends the person’s cookies to the site the clip came from', async () => {
    serving('image/png')
    await uploaded('t', ['https://images.site.example/a.png'], PAGE)

    expect(fetched[0]?.credentials).toBe('include')
  })

  // The extension holds every host, and Chrome counts a fetch from here as the
  // target's own site, so cookies would ride on a request the page could never
  // have had sent. The addresses come out of markup the page wrote.
  test('sends none to a host the page merely named', async () => {
    serving('image/png')
    await uploaded('t', ['https://intranet.corp.test/secret.png'], PAGE)

    expect(fetched[0]?.credentials).toBe('omit')
  })

  test('does not fetch a picture the page carried inside itself', async () => {
    serving('image/png')
    const urls = await uploaded('t', ['data:image/png;base64,iVBORw0KGgo='], PAGE)

    expect(fetched).toEqual([])
    expect(urls).toEqual(['data:image/png;base64,iVBORw0KGgo='])
  })

  test('leaves a picture the blob route would not store where it is', async () => {
    serving('image/svg+xml')
    const urls = await uploaded('t', ['https://site.example/a.svg'], PAGE)

    expect(urls).toEqual(['https://site.example/a.svg'])
  })

  test('points a stored picture at the account', async () => {
    serving('image/png')
    const urls = await uploaded('t', ['https://site.example/a.png'], PAGE)

    expect(urls[0]).toMatch(new RegExp(`^${BASE}/i/[0-9a-f]{64}\\.png$`))
  })

  test('leaves one that is already ours alone', async () => {
    serving('image/png')
    const own = `${BASE}/i/${'a'.repeat(64)}.png`

    expect(await uploaded('t', [own], PAGE)).toEqual([own])
    expect(fetched).toEqual([])
  })

  test('keeps the addresses past the sixtieth without asking for them', async () => {
    serving('image/png')
    const urls = Array.from({ length: 62 }, (_, at) => `https://site.example/${at}.png`)

    expect(await uploaded('t', urls, PAGE)).toHaveLength(62)
    expect(fetched.filter((one) => !one.url.startsWith(`${BASE}/v1/`))).toHaveLength(60)
  })

  test('gives up the whole clip when the account has no room', async () => {
    vi.stubGlobal('fetch', (url: string) => {
      if (url.startsWith(`${BASE}/v1/blobs/`)) {
        return Promise.resolve({
          ok: false,
          status: 507,
          text: () => Promise.resolve('{"error":"Your account is out of space."}'),
        })
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      })
    })

    await expect(uploaded('t', ['https://site.example/a.png'], PAGE)).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})
