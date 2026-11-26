import { dayOf, usageEventOf, type UsageEvent } from '@orden/sync-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { elapse } from '../../../../test/effects/settle'

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
  test('counts nothing once usage data is turned off', async () => {
    localStorage.setItem(HELPING, 'false')
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
  let queue: UsageEvent[] = []
  const how = (post: () => Promise<unknown>) => ({
    queue: () => queue,
    keepQueue: (events: UsageEvent[]) => (queue = events),
    post,
  })
  beforeEach(() => {
    queue = [{ ...common(), kind: 'daily', day: TODAY }]
  })
  test('keeps the queue while offline and sends it later', async () => {
    const { flush } = await import('./queue')
    const { ApiError } = await import('../../accounts/src/client')
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
    expect(await flush(how(() => Promise.reject(new ApiError(400, 'no', null))))).toBe('done')
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
describe('which builds send', () => {
  test('only a build made as a release sends, whatever its version says', async () => {
    const { sendable } = await import('./queue')
    expect(sendable({ release: true, held: false })).toBe(true)
    expect(sendable({ release: false, held: false })).toBe(false)
    expect(sendable({ release: true, held: true })).toBe(false)
  })
  test('a test or dev build is never a release, so it queues and sends nothing even when asked to', async () => {
    expect(__ORDEN_RELEASE__).toBe(false)
    localStorage.setItem(HELPING, 'true')
    const posted = vi.fn()
    vi.doMock('../../accounts/src/api', async (actual) => ({
      ...(await actual<typeof import('../../accounts/src/api')>()),
      request: posted,
    }))
    vi.useFakeTimers()
    const { watchUsage } = await import('./watch.svelte')
    const stop = await watchUsage(true)
    await elapse(2 * 60 * 60 * 1000)
    stop()
    expect(posted).not.toHaveBeenCalled()
    expect(localStorage.getItem('orden:usage-queue')).toBe(null)
    expect(localStorage.getItem('orden:usage-pinged')).toBe(null)
    vi.doUnmock('../../accounts/src/api')
  })
  test('a build the runner holds back queues and sends nothing', async () => {
    localStorage.setItem(HELPING, 'true')
    const { watchUsage } = await import('./watch.svelte')
    const stop = await watchUsage(false)
    stop()
    expect(localStorage.getItem('orden:usage-queue')).toBe(null)
    expect(localStorage.getItem('orden:usage-pinged')).toBe(null)
  })
})
describe('one install keeps one id', () => {
  test('the id survives a restart and an update, and leaves with usage data turned off', async () => {
    localStorage.setItem(HELPING, 'true')
    const first = (await load()).usageChoice.install()
    vi.resetModules()
    const again = await load()
    expect(again.usageChoice.install()).toBe(first)
    again.usageChoice.setHelping(false)
    expect(localStorage.getItem(INSTALL)).toBe('null')
  })
  test('usage data is on until it is turned off, and off it keeps no id and nothing to send', async () => {
    const fresh = await load()
    expect(fresh.usageChoice.helping).toBe(true)
    const { pruned } = await import('./queue')
    const ping = { ...common(), kind: 'daily' as const, day: TODAY, install: fresh.usageChoice.install() }
    expect(typeof usageEventOf(ping)).toBe('object')
    expect(pruned([ping], TODAY, true)).toEqual([ping])
    localStorage.setItem('orden:usage-queue', JSON.stringify([ping]))
    fresh.usageChoice.setHelping(false)
    expect(pruned([ping], TODAY, false)).toEqual([])
    expect(localStorage.getItem(INSTALL)).toBe('null')
    expect(localStorage.getItem('orden:usage-queue')).toBe('[]')
    vi.resetModules()
    expect((await load()).usageChoice.helping).toBe(false)
  })
})
