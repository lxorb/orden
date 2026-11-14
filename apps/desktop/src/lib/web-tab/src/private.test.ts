import { beforeEach, expect, test, vi } from 'vitest'

const told: { tab: string; muted: boolean }[] = []

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
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
vi.doMock('../../workspace.svelte', () => ({
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

  expect(localStorage.getItem('orden:web-zooms')).toBeNull()
  expect(sites.zoomOf('secret.example', 'priv')).toBe(1.5)
  expect(sites.zoomOf('secret.example')).toBe(1)

  sites.forgetAside('priv')
  expect(sites.zoomOf('secret.example', 'priv')).toBe(1)
})

test('a site muted in a private tab is muted there and written nowhere', () => {
  sites.setMuted('secret.example', true, 'priv')

  expect(localStorage.getItem('orden:web-muted')).toBeNull()
  expect(sites.isMuted('secret.example', 'priv')).toBe(true)
  expect(sites.isMuted('secret.example')).toBe(false)
})

test('a private page answered is remembered for the private session and written nowhere', () => {
  grants.heard({
    id: 1,
    tab: 'priv',
    site: 'secret.example',
    ask: 'notifications',
    privately: true,
  })
  grants.answer(grants.asking[0]!, false)

  expect(localStorage.getItem('orden:web-grants')).toBeNull()
  expect(grants.said('secret.example', 'notifications')).toBeNull()
  expect(grants.said('secret.example', 'notifications', true)).toBe('block')

  grants.heard({
    id: 2,
    tab: 'priv',
    site: 'secret.example',
    ask: 'notifications',
    privately: true,
  })
  expect(grants.asking).toEqual([])

  grants.heard({
    id: 3,
    tab: 'open',
    site: 'secret.example',
    ask: 'notifications',
    privately: false,
  })
  expect(grants.asking.map((one) => one.id)).toEqual([3])
  grants.dismiss(grants.asking[0]!)

  grants.dropped('priv', false)
  expect(grants.said('secret.example', 'notifications', true)).toBeNull()
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
  sites.setMuted('loud.example', false, 'priv')

  await muteSite('open', true)

  expect(pages.of('open').muted).toBe(true)
  expect(pages.of('priv').muted).toBe(false)
  expect(sites.isMuted('loud.example')).toBe(true)
  expect(told.find((one) => one.tab === 'priv')?.muted ?? false).toBe(false)
})
