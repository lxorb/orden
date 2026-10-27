/** A private tab writes nothing down about where it went: not what a site was allowed,
 *  not how large it was drawn, not that it was muted. What it was told lasts as long as
 *  the tab, in memory. See private.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(undefined),
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

const { heard } = await import('./heard')
const { Page } = await import('./pages.svelte')
const sites = await import('./sites')
const { grants } = await import('./permissions.svelte')

beforeEach(() => {
  localStorage.clear()
  sites.reread()
})

function privatePage(): InstanceType<typeof Page> {
  const page = new Page()
  page.url = 'https://secret.example/x'
  page.inPrivate = true
  return page
}

test('a private page zoomed keeps the size for its tab and writes nothing', () => {
  heard(privatePage(), { tab: 'priv', said: 'zoom', factor: 1.5 })

  expect(localStorage.getItem('nib:web-zooms')).toBeNull()
  expect(sites.zoomOf('secret.example', 'priv')).toBe(1.5)
  expect(sites.zoomOf('secret.example')).toBe(1)

  sites.forgetAside('priv')
  expect(sites.zoomOf('secret.example', 'priv')).toBe(1)
})

test('a site muted in a private tab is muted there and written nowhere', () => {
  sites.setMuted('secret.example', true, 'priv')

  expect(localStorage.getItem('nib:web-muted')).toBeNull()
  expect(sites.isMuted('secret.example', 'priv')).toBe(true)
  expect(sites.isMuted('secret.example')).toBe(false)
})

test('a private page answered is remembered for its tab and written nowhere', () => {
  grants.heard({
    id: 1,
    tab: 'priv',
    site: 'secret.example',
    ask: 'notifications',
    inPrivate: true,
  })
  grants.answer(grants.asking[0]!, false)

  expect(localStorage.getItem('nib:web-grants')).toBeNull()
  expect(grants.said('secret.example', 'notifications')).toBeNull()
  expect(grants.said('secret.example', 'notifications', 'priv')).toBe('block')

  // Asked again in the same tab: answered from what was said.
  grants.heard({
    id: 2,
    tab: 'priv',
    site: 'secret.example',
    ask: 'notifications',
    inPrivate: true,
  })
  expect(grants.asking).toEqual([])

  // A tab that is not private is asked.
  grants.heard({ id: 3, tab: 'open', site: 'secret.example', ask: 'notifications' })
  expect(grants.asking.map((one) => one.id)).toEqual([3])
  grants.dismiss(grants.asking[0]!)

  // The tab closed: what it was told is gone with it.
  grants.dropped('priv')
  expect(grants.said('secret.example', 'notifications', 'priv')).toBeNull()
})
