/** A private tab writes nothing down about where it went: not what a site was allowed,
 *  not how large it was drawn, not that it was muted. What it was told lasts as long as
 *  the tab, in memory. See private.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const told: { tab: string; muted: boolean }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'web_mute') told.push({ tab: String(args.tab), muted: args.muted === true })
    return Promise.resolve(undefined)
  },
}))

const tabs: { id: string; kind: string }[] = []

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
const { pages } = await import('./pages.svelte')
// mute.ts fetches the workspace with the press; only its tabs are asked for here.
vi.doMock('../workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return tabs
    },
  },
}))
const { muteSite } = await import('./mute')

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

test('a site muted from a tab that is not private leaves a private tab’s own choice', async () => {
  for (const [id, inPrivate] of [
    ['open', false],
    ['priv', true],
  ] as const) {
    tabs.push({ id, kind: 'web' })
    const page = pages.of(id)
    page.url = 'https://loud.example/'
    page.inPrivate = inPrivate
  }
  // The private tab let the site be heard, for itself.
  sites.setMuted('loud.example', false, 'priv')

  await muteSite('open', true)

  expect(pages.of('open').muted).toBe(true)
  expect(pages.of('priv').muted).toBe(false)
  expect(sites.isMuted('loud.example')).toBe(true)
  expect(told.find((one) => one.tab === 'priv')?.muted ?? false).toBe(false)
})
