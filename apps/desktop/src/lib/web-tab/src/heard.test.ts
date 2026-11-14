import { beforeEach, expect, test, vi } from 'vitest'

const muted: { tab: string; muted: boolean }[] = []

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_mute') muted.push({ tab: String(args.tab), muted: args.muted === true })
    return Promise.resolve(undefined)
  },
}))

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

const { found, heard, readFound, readSaid, readUnplayable } = await import('./heard')
const { Page } = await import('./pages.svelte')
const sites = await import('./sites')

function on(url: string) {
  const page = new Page()
  page.url = url
  return page
}

beforeEach(() => {
  muted.length = 0
  localStorage.clear()
  sites.reread()
})

test('reads the three things a page is said to be doing, and nothing else', () => {
  expect(readSaid({ tab: 'a', said: 'sound', playing: true, muted: false })).toEqual({
    tab: 'a',
    said: 'sound',
    playing: true,
    muted: false,
  })
  expect(readSaid({ tab: 'a', said: 'fill', on: true })).toEqual({
    tab: 'a',
    said: 'fill',
    on: true,
  })
  expect(readSaid({ tab: 'a', said: 'zoom', factor: 1.5 })).toEqual({
    tab: 'a',
    said: 'zoom',
    factor: 1.5,
  })

  expect(readSaid({ tab: 'a', said: 'zoom', factor: 0 })).toBe(null)
  expect(readSaid({ tab: 'a', said: 'shout' })).toBe(null)
  expect(readSaid({ said: 'fill', on: true })).toBe(null)
  expect(readSaid('fill')).toBe(null)
})

test('a find with nothing found lights nothing', () => {
  expect(readFound({ tab: 'a', count: 3, at: 1 })).toEqual({ tab: 'a', count: 3, at: 1 })
  expect(readFound({ tab: 'a', count: 0, at: 0 })).toEqual({ tab: 'a', count: 0, at: -1 })
  expect(readFound({ tab: 'a', count: '3', at: 1 })).toBe(null)

  const page = on('https://example.com/')
  found(page, { tab: 'a', count: 4, at: 2 })
  expect([page.find.count, page.find.at]).toEqual([4, 2])
})

test('a page playing puts the speaker on its tab, and falling quiet takes it off', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'sound', playing: true, muted: false })
  expect(page.playing).toBe(true)
  heard(page, { tab: 'a', said: 'sound', playing: false, muted: false })
  expect(page.playing).toBe(false)
  expect(muted).toEqual([])
})

test('a muted site is muted the moment it plays', () => {
  sites.setMuted('example.com', true)
  const page = on('https://www.example.com/watch')

  heard(page, { tab: 'a', said: 'sound', playing: true, muted: false })
  expect(muted).toEqual([{ tab: 'a', muted: true }])
  expect(page.muted).toBe(true)
})

test('a site nobody muted is heard, whatever the tab was told before', () => {
  const page = on('https://other.example/')

  heard(page, { tab: 'a', said: 'sound', playing: true, muted: true })
  expect(muted).toEqual([{ tab: 'a', muted: false }])
})

test('a page holding the screen says so on its tab', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'fill', on: true })
  expect(page.filling).toBe(true)
  heard(page, { tab: 'a', said: 'fill', on: false })
  expect(page.filling).toBe(false)
})

test('a zoom made inside the page is the size the site is kept at', () => {
  const page = on('https://example.com/')
  heard(page, { tab: 'a', said: 'zoom', factor: 1.25 })
  expect(page.zoom).toBe(1.25)
  expect(sites.zoomOf('example.com')).toBe(1.25)
})

test('reads how a page arrived, and why it did not', () => {
  const arrived = { tab: 'a', said: 'arrived', url: 'https://a.example/' } as const
  expect(readSaid({ ...arrived, failure: null })).toEqual({
    ...arrived,
    failure: null,
    bare: false,
    reason: null,
  })
  expect(readSaid({ ...arrived, failure: 'unreachable' })).toEqual({
    ...arrived,
    failure: 'unreachable',
    bare: false,
    reason: null,
  })
  expect(readSaid({ ...arrived, failure: 'x' })).toEqual({
    ...arrived,
    failure: null,
    bare: false,
    reason: null,
  })
  expect(readSaid({ ...arrived, failure: 'other', bare: true, reason: 'No such server.' })).toEqual(
    { ...arrived, failure: 'other', bare: true, reason: 'No such server.' },
  )
  expect(readSaid({ ...arrived, failure: 'other', bare: 'yes', reason: 4 })).toEqual({
    ...arrived,
    failure: 'other',
    bare: false,
    reason: null,
  })
  expect(readSaid({ tab: 'a', said: 'arrived' })).toBe(null)
})

test('a page that did not arrive and that nothing was drawn for is said, and only that', () => {
  const page = on('https://no-such-host.invalid/')
  const failed: [string, unknown][] = []
  const fail = (tab: string, not: unknown) => void failed.push([tab, not])
  const arrived = { tab: 'a', said: 'arrived', url: 'https://no-such-host.invalid/' } as const

  heard(
    page,
    { ...arrived, failure: 'other', bare: true, reason: 'No such server.' },
    undefined,
    undefined,
    fail,
  )
  expect(failed).toEqual([
    ['a', { url: 'https://no-such-host.invalid/', failure: 'other', reason: 'No such server.' }],
  ])

  heard(
    page,
    { ...arrived, failure: 'other', bare: false, reason: null },
    undefined,
    undefined,
    fail,
  )
  heard(page, { ...arrived, failure: null, bare: false, reason: null }, undefined, undefined, fail)
  expect(failed).toHaveLength(1)
})

test('an upgrade that falls back to http is never said to have failed', () => {
  const page = on('https://example.com')
  page.upgrade = { tried: 'https://example.com', fallback: 'http://example.com' }
  const went: string[] = []
  const failed: string[] = []
  heard(
    page,
    {
      tab: 'a',
      said: 'arrived',
      url: 'https://example.com/',
      failure: 'unreachable',
      bare: true,
      reason: 'Could not connect.',
    },
    (_, url) => void went.push(url),
    undefined,
    (tab) => void failed.push(tab),
  )
  expect(went).toEqual(['http://example.com'])
  expect(failed).toEqual([])

  heard(
    page,
    {
      tab: 'a',
      said: 'arrived',
      url: 'http://example.com/',
      failure: 'unreachable',
      bare: true,
      reason: 'Could not connect.',
    },
    (_, url) => void went.push(url),
    undefined,
    (tab) => void failed.push(tab),
  )
  expect(failed).toEqual(['a'])
})

test('an upgrade nothing answered goes to plain http, once', () => {
  const page = on('https://example.com')
  page.upgrade = { tried: 'https://example.com', fallback: 'http://example.com' }
  const went: [string, string][] = []
  const go = (tab: string, url: string) => void went.push([tab, url])

  heard(
    page,
    {
      tab: 'a',
      said: 'arrived',
      url: 'https://svelte.dev/',
      failure: null,
      bare: false,
      reason: null,
    },
    go,
  )
  expect(went).toEqual([])
  expect(page.upgrade).not.toBeNull()

  heard(
    page,
    {
      tab: 'a',
      said: 'arrived',
      url: 'https://example.com/',
      failure: 'unreachable',
      bare: false,
      reason: null,
    },
    go,
  )
  expect(went).toEqual([['a', 'http://example.com']])
  expect(page.upgrade).toBeNull()

  heard(
    page,
    {
      tab: 'a',
      said: 'arrived',
      url: 'https://example.com/',
      failure: 'unreachable',
      bare: false,
      reason: null,
    },
    go,
  )
  expect(went).toHaveLength(1)
})

test('a wrong certificate, or a page that arrived, settles an upgrade where it is', () => {
  for (const failure of ['certificate', null] as const) {
    const page = on('https://example.com')
    page.upgrade = { tried: 'https://example.com', fallback: 'http://example.com' }
    const went: string[] = []
    heard(
      page,
      {
        tab: 'a',
        said: 'arrived',
        url: 'https://example.com/',
        failure,
        bare: false,
        reason: null,
      },
      (_, url) => went.push(url),
    )
    expect(went).toEqual([])
    expect(page.upgrade).toBeNull()
  }
})

test('a tab that would not play something is read, and nothing else is', () => {
  expect(readUnplayable({ tab: 'a' })).toBe('a')
  expect(readUnplayable({ tab: 1 })).toBe(null)
  expect(readUnplayable(null)).toBe(null)
})
