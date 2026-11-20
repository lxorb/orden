import { beforeEach, describe, expect, test, vi } from 'vitest'
import { serveSyncStore } from '../../../../test/sync-store'

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
const { ArchivedSpaces } = await import('../../space-kept/src/api')
interface Space {
  id: string
  name: string
  root: string
}
const workspace = vi.hoisted(() => {
  const held = {
    spaces: [] as Space[],
    activeSpaceId: null as string | null,
    openedArchived: null as string | null,
    archivedSpaces: null as unknown as InstanceType<typeof ArchivedSpaces>,
    get activeSpace(): Space | null {
      return this.spaces.find((one) => one.id === this.activeSpaceId) ?? null
    },
    get shownSpaces(): Space[] {
      return this.spaces.filter((one) => !this.archivedSpaces.has(one.root) || one.id === this.openedArchived)
    },
    showSpace(id: string) {
      this.activeSpaceId = id
      return Promise.resolve()
    },
    leaveArchived: () => Promise.resolve(),
  }
  return held
})
const server: { settings: Record<string, unknown>; sent: Record<string, unknown>[]; offline: boolean } = {
  settings: {},
  sent: [],
  offline: false,
}
vi.stubGlobal('fetch', (_url: string, init: { method?: string; body?: string } = {}) => {
  if (server.offline) return Promise.reject(new TypeError('offline'))
  if (init.method === 'PATCH') {
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
    server.sent.push(body)
    server.settings = { ...server.settings, ...body }
  }
  return Promise.resolve(new Response(JSON.stringify({ settings: server.settings }), { status: 200 }))
})
vi.mock('../../workspace/src/api', async (actual) => ({ ...(await actual<object>()), workspace }))
vi.mock('../../accounts/src/account.svelte', async () => ({
  account: (await import('../../accounts/test/fakes')).accountDouble('a'),
}))
const store = vi.hoisted(() => {
  const held = {
    mapped: true,
    remoteIdFor: (root: string): string | null => (held.mapped ? `id-${root.slice(8)}` : null),
  }
  return held
})
vi.mock('../../sync-store/src/api', () => ({ sync: store }))
serveSyncStore(store)
const archive = await (await import('../src/api')).spaceArchiving()
const space = (name: string): Space => ({ id: name, name, root: `/spaces/${name}` })
const heardOnce = (ids: string[]) =>
  localStorage.setItem('orden:settings-heard', JSON.stringify({ who: 'a', settings: { archivedSpaces: ids } }))
async function archivedOffline(): Promise<void> {
  heardOnce([])
  await archive.receive({ archivedSpaces: [] })
  server.settings = { archivedSpaces: ['id-Two'] }
  server.offline = true
  const three = workspace.spaces[2]
  if (three) await archive.archiveSpace(three)
  server.offline = false
}
beforeEach(() => {
  localStorage.clear()
  workspace.archivedSpaces = new ArchivedSpaces()
  workspace.spaces = [space('One'), space('Home'), space('Three')]
  workspace.activeSpaceId = 'One'
  server.settings = {}
  server.sent.length = 0
  server.offline = false
  store.mapped = true
})
describe('a space archived on one device', () => {
  test('never unarchives a space another device archived meanwhile, and this device then hides both', async () => {
    await archivedOffline()
    await archive.listed()
    await vi.waitFor(() => expect(server.sent.at(-1)?.archivedSpaces).toEqual(['id-Two', 'id-Three']))
    workspace.spaces = [...workspace.spaces, space('Two')]
    await vi.waitFor(() => expect(archive.archivedSpaces().map((one) => one.name)).toEqual(['Three', 'Two']))
  })
  test('nor after a reload that heard the other device first while this one still owed its own', async () => {
    await archivedOffline()
    heardOnce(['id-Two'])
    await archive.listed()
    await vi.waitFor(() => expect(server.sent.at(-1)?.archivedSpaces).toEqual(['id-Two', 'id-Three']))
  })
  test('nor when it comes back before it knows which of its spaces are which', async () => {
    await archivedOffline()
    heardOnce(['id-Two'])
    store.mapped = false
    await archive.listed()
    store.mapped = true
    await vi.waitFor(() => expect(server.sent.at(-1)?.archivedSpaces).toEqual(['id-Two', 'id-Three']))
  })
})
