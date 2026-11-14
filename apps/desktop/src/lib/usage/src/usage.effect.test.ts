import { dayOf, usageEventOf, type UsageEvent } from '@orden/sync-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const HELPING = 'orden:usage-help'
const INSTALL = 'orden:usage-install'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

async function load() {
  const choice = await import('./choice.svelte')
  const tally = await import('./tally')
  return { ...choice, ...tally }
}

const TODAY = dayOf(Date.now())

function common() {
  return {
    v: 1 as const,
    app: { version: '0.21.1', channel: 'stable' as const },
    system: {
      os: 'linux' as const,
      arch: 'x86_64' as const,
      form: 'desktop' as const,
      engine: 'webkit' as const,
    },
    language: 'en',
    screen: 'large' as const,
    signedIn: false,
  }
}

describe('the day’s tally', () => {
  test('counts nothing until usage data is turned on', async () => {
    const { ran, changed, storedTallies, saveTallies } = await load()
    ran('print', 'palette')
    changed('general.searchEngine', 'duckduckgo')
    saveTallies()
    expect(storedTallies()).toEqual({})
  })

  test('counts commands by their stable id and the way they ran', async () => {
    localStorage.setItem(HELPING, 'true')
    const { ran, storedTallies, saveTallies } = await load()
    ran('palette.export', 'palette')
    ran('palette.export', 'palette')
    ran('palette.export', 'shortcut')
    ran('space:6f1c0b8e-my-private-space', 'palette')
    ran('layout:Taxes 2026', 'menu')
    saveTallies()
    expect(storedTallies()[TODAY]?.commands).toEqual({
      'palette.export': { palette: 2, shortcut: 1 },
      space: { palette: 1 },
      layout: { menu: 1 },
    })
  })

  test('keeps setting values only when they are option names', async () => {
    localStorage.setItem(HELPING, 'true')
    const { changed, storedTallies, saveTallies } = await load()
    changed('general.crashReports', false)
    changed('general.searchEngine', 'duckduckgo')
    changed('general.shell', '/home/anna/bin/fish')
    changed('general.searchEngineAddress', 'https://search.example/?q=%s')
    changed('appearance.monoFont', 'Anna’s Font')
    saveTallies()
    expect(storedTallies()[TODAY]?.settings).toEqual({
      'general.crashReports': { off: 1 },
      'general.searchEngine': { duckduckgo: 1 },
      'general.shell': { other: 1 },
      'general.searchEngineAddress': { other: 1 },
      'appearance.monoFont': { other: 1 },
    })
  })

  test('turning usage data off forgets the tally and the install id', async () => {
    localStorage.setItem(HELPING, 'true')
    const { ran, usageChoice, storedTallies, saveTallies } = await load()
    const before = usageChoice.install()
    ran('print', 'menu')
    usageChoice.setHelping(false)
    saveTallies()
    expect(storedTallies()).toEqual({})
    expect(localStorage.getItem(INSTALL)).toBe('null')
    usageChoice.setHelping(true)
    expect(usageChoice.install()).not.toBe(before)
    expect(usageChoice.install()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('nothing private is ever sent', () => {
  const PRIVATE = [
    '/home/anna/Notes/Diary.md',
    'C:\\Users\\anna',
    'Diary.md',
    'https://bank.example/login',
    'anna@example.com',
    'my secret search',
    'Dear diary',
  ]

  test('a day fed with paths, addresses and text still sends none of them', async () => {
    localStorage.setItem(HELPING, 'true')
    const { ran, changed, stepped, spent, storedTallies, saveTallies } = await load()
    for (const one of PRIVATE) {
      ran(one, 'palette')
      ran(`space:${one}`, 'menu')
      changed('general.shell', one)
      changed(one, 'on')
      stepped(one)
      spent('tabs', one)
      spent('features', one)
    }
    saveTallies()
    const text = JSON.stringify(storedTallies())
    for (const one of PRIVATE) expect(text).not.toContain(one)
    for (const one of PRIVATE) expect(text.toLowerCase()).not.toContain(one.toLowerCase())
  })

  test('the shared schema refuses anything outside the allowlist', () => {
    const base = { ...common(), kind: 'daily', day: TODAY }
    expect(typeof usageEventOf(base)).toBe('object')
    for (const extra of ['email', 'path', 'url', 'search', 'text', 'name', 'ip', 'userAgent']) {
      expect(typeof usageEventOf({ ...base, [extra]: 'x' })).toBe('string')
    }
  })
})

describe('the queue', () => {
  const daily = (day: string): UsageEvent => ({ ...common(), kind: 'daily', day })

  test('drops days older than thirty, usage data once turned off, and anything past its cap', async () => {
    const { pruned, MOST_QUEUED } = await import('./queue')
    const old = dayOf(Date.now() - 31 * 86_400_000)
    expect(pruned([daily(old), daily(TODAY)], TODAY, false)).toEqual([daily(TODAY)])
    expect(pruned([daily(TODAY)], TODAY, false)).toEqual([daily(TODAY)])
    const many = Array.from({ length: MOST_QUEUED + 5 }, () => daily(TODAY))
    expect(pruned(many, TODAY, true)).toHaveLength(MOST_QUEUED)
  })

  test('keeps the queue while offline and sends it later', async () => {
    const { flush } = await import('./queue')
    const { ApiError } = await import('../../accounts/src/client')
    let queue: UsageEvent[] = [daily(TODAY)]
    const how = (post: () => Promise<unknown>) => ({
      queue: () => queue,
      keepQueue: (events: UsageEvent[]) => (queue = events),
      post,
    })

    expect(await flush(how(() => Promise.reject(new TypeError('offline'))))).toBe('later')
    expect(queue).toHaveLength(1)
    expect(await flush(how(() => Promise.reject(new ApiError(503, 'later', null))))).toBe('later')
    expect(queue).toHaveLength(1)
    expect(await flush(how(() => Promise.resolve({ ok: true })))).toBe('done')
    expect(queue).toEqual([])
  })

  test('drops what the server refuses instead of sending it forever', async () => {
    const { flush } = await import('./queue')
    const { ApiError } = await import('../../accounts/src/client')
    let queue: UsageEvent[] = [daily(TODAY)]
    const result = await flush({
      queue: () => queue,
      keepQueue: (events) => (queue = events),
      post: () => Promise.reject(new ApiError(400, 'no', null)),
    })
    expect(result).toBe('done')
    expect(queue).toEqual([])
  })
})

describe('what a device says about itself', () => {
  test('keeps to buckets and short versions', async () => {
    const { commonOf } = await import('./system')
    const said = commonOf({
      version: '0.22.0-unstable.4+c0ffee1',
      channel: 'unstable',
      native: { platform: 'windows', version: '10.0.26100', arch: 'x86_64' },
      mobile: false,
      agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131',
      language: 'de-CH',
      width: 2560,
      signedIn: true,
    })
    expect(said).toEqual({
      app: { version: '0.22.0-unstable.4', channel: 'unstable' },
      system: {
        os: 'windows',
        osVersion: '10.0',
        arch: 'x86_64',
        form: 'desktop',
        engine: 'webview2',
      },
      language: 'de-CH',
      screen: 'huge',
      signedIn: true,
    })
    expect(typeof usageEventOf({ v: 1, kind: 'daily', day: TODAY, ...said })).toBe('object')
  })

  test('a browser is told apart by its engine only', async () => {
    const { commonOf } = await import('./system')
    const said = commonOf({
      version: '0.21.1',
      channel: 'stable',
      native: null,
      mobile: false,
      agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
      language: 'fr',
      width: 1280,
      signedIn: false,
    })
    expect(said.system).toEqual({ os: 'linux', arch: 'other', form: 'web', engine: 'gecko' })
  })
})
