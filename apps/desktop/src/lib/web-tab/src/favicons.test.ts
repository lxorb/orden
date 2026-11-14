import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

function mark(n: number, bytes = 0): string {
  return `data:image/png;base64,${btoa(`mark-${String(n)}${'.'.repeat(bytes)}`)}`
}

async function fresh() {
  vi.resetModules()
  return { ...(await import('./pages.svelte')), ...(await import('./favicons')) }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a mark seen', () => {
  test('is found again at its page after a restart', async () => {
    const one = await fresh()
    one.saw('https://docs.google.com/spreadsheets/d/1/edit', mark(1))
    vi.runAllTimers()

    const two = await fresh()
    expect(two.favicons.of('https://docs.google.com/spreadsheets/d/1/edit?gid=0')).toBe(mark(1))
  })

  test('and at every other page of its origin, where that page showed none', async () => {
    const { favicons, saw } = await fresh()
    saw('https://docs.google.com/spreadsheets/d/1/edit', mark(1))
    saw('https://docs.google.com/document/d/2/edit', mark(2))

    expect(favicons.of('https://docs.google.com/spreadsheets/d/1/edit')).toBe(mark(1))
    expect(favicons.of('https://docs.google.com/document/d/2/edit')).toBe(mark(2))
    expect(favicons.of('https://docs.google.com/presentation/d/3/edit')).toBe(mark(2))
  })

  test('but not at another origin of the same site: mail and docs are two products', async () => {
    const { favicons, saw } = await fresh()
    saw('https://mail.google.com/mail/u/0/', mark(1))

    expect(favicons.of('https://docs.google.com/')).toBeNull()
    expect(favicons.of('http://mail.google.com/')).toBeNull()
  })

  test('a page that redraws its mark replaces it, and keeps one picture', async () => {
    const { favicons, saw } = await fresh()
    for (let n = 0; n < 50; n++) saw('https://web.whatsapp.com/', mark(n))
    vi.runAllTimers()

    expect(favicons.of('https://web.whatsapp.com/')).toBe(mark(49))
    expect(storedPictures()).toEqual([mark(49)])
  })

  test('is only a picture a page can draw, of a size worth keeping', async () => {
    const { favicons, saw } = await fresh()
    for (const said of [
      'https://a.example/favicon.ico',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,"><script>',
      `data:image/png;base64,${'A'.repeat(64 * 1024)}`,
    ]) {
      saw('https://a.example/', said)
    }

    expect(favicons.of('https://a.example/')).toBeNull()
  })
})

function storedPictures(): string[] {
  const out: string[] = []
  for (let at = 0; at < localStorage.length; at++) {
    const key = localStorage.key(at) ?? ''
    if (key.startsWith('orden:favicon:')) out.push(localStorage.getItem(key) ?? '')
  }
  return out
}

describe('the ceiling', () => {
  test('holds 500 pages, the least recently used going first', async () => {
    const { favicons, saw } = await fresh()
    for (let n = 0; n < 300; n++) {
      vi.setSystemTime(n * 1000)
      saw(`https://site${String(n)}.example/`, mark(n))
    }
    vi.runAllTimers()

    expect(favicons.of('https://site0.example/')).toBeNull()
    expect(favicons.of('https://site49.example/')).toBeNull()
    expect(favicons.of('https://site50.example/')).toBe(mark(50))
    expect(favicons.of('https://site299.example/')).toBe(mark(299))
    expect(storedPictures()).toHaveLength(250)
  })

  test('and half a megabyte of pictures, a page drawn lately outliving one that was not', async () => {
    const { favicons, saw } = await fresh()
    for (let n = 0; n < 25; n++) {
      vi.setSystemTime(Date.UTC(2026, 0, 1) + n * 1000)
      saw(`https://site${String(n)}.example/`, mark(n, 15_400))
    }
    vi.setSystemTime(Date.UTC(2026, 0, 3))
    expect(favicons.of('https://site0.example/')).toBe(mark(0, 15_400))
    saw('https://late.example/', mark(99, 15_400))
    vi.runAllTimers()

    expect(favicons.of('https://site0.example/')).toBe(mark(0, 15_400))
    expect(favicons.of('https://site1.example/')).toBeNull()
    expect(favicons.of('https://site2.example/')).toBe(mark(2, 15_400))
    expect(favicons.of('https://late.example/')).toBe(mark(99, 15_400))
    const text = storedPictures().reduce((sum, one) => sum + one.length, 0)
    expect(text).toBeLessThanOrEqual(512 * 1024)
  })
})

describe('forgetting', () => {
  test('a page forgotten takes its mark and its origin s with it, on disk too', async () => {
    const one = await fresh()
    one.saw('https://secret.example/a', mark(1))
    vi.runAllTimers()
    one.forget('https://secret.example/a#top')
    vi.runAllTimers()

    expect(one.favicons.of('https://secret.example/a')).toBeNull()
    expect(one.favicons.of('https://secret.example/b')).toBeNull()
    expect(storedPictures()).toEqual([])

    const two = await fresh()
    expect(two.favicons.of('https://secret.example/a')).toBeNull()
  })

  test('a history row removed is a mark forgotten', async () => {
    const { favicons, saw } = await fresh()
    const { visited } = await import('./visited')
    saw('https://secret.example/a', mark(1))
    visited.saw('orden:web-visits', 'tab', 'https://secret.example/a', 'Secret')

    visited.remove('orden:web-visits', 'https://secret.example/a')

    expect(favicons.of('https://secret.example/a')).toBeNull()
  })
})

describe('which mark is drawn', () => {
  test('the live page s own, whatever the cache says', async () => {
    const { saw, siteMark } = await fresh()
    saw('https://a.example/', mark(1))

    expect(siteMark(mark(2), 'https://a.example/', mark(3))).toBe(mark(2))
  })

  test('then the cache, then what the file wrote, then nothing', async () => {
    const { saw, siteMark } = await fresh()
    saw('https://a.example/', mark(1))

    expect(siteMark(null, 'https://a.example/x', mark(3))).toBe(mark(1))
    expect(siteMark(null, 'https://b.example/', mark(3))).toBe(mark(3))
    expect(siteMark(null, 'https://b.example/')).toBeNull()
    expect(siteMark(null, null)).toBeNull()
  })

  test('and a store that cannot be read is an empty cache, not an error', async () => {
    localStorage.setItem('orden:favicons', '{"pages":{"https://a.example/":[4,"x"]},"sizes":[]}')
    const { siteMark } = await fresh()

    expect(siteMark(null, 'https://a.example/', mark(3))).toBe(mark(3))
  })
})
