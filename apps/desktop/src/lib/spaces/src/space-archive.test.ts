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
    leaveArchived: vi.fn((): Promise<void> => leave()),
  }
  async function leave(): Promise<void> {
    const open = held.activeSpace
    if (!open || !held.archivedSpaces.has(open.root) || open.id === held.openedArchived) return
    const next = held.shownSpaces[0]
    if (next) await held.showSpace(next.id)
    else held.archivedSpaces.set(open.root, false)
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
vi.mock('../../workspace/src/api', () => ({ workspace }))
vi.mock('../../accounts/src/account.svelte', async () => ({
  account: (await import('../../accounts/test/fakes')).accountDouble('a'),
}))
const store = vi.hoisted(() => ({
  remoteIdFor: (root: string) => (root === '/spaces/Local' ? null : `id-${root.slice(8)}`),
}))
vi.mock('../../sync-store/src/api', () => ({ sync: store }))
serveSyncStore(store)
const archive = await import('./space-archive')
const { account } = await import('../../accounts/src/api')
const double = account as unknown as import('../../accounts/test/fakes').AccountDouble
const settled = () => vi.waitFor(() => expect(localStorage.getItem('orden:archived-spaces-owed')).toBeNull())
const last = () => server.sent.at(-1)
const space = (name: string): Space => ({ id: name, name, root: `/spaces/${name}` })
function at(place: number): Space {
  const found = workspace.spaces[place]
  if (!found) throw new Error(`no space at ${String(place)}`)
  return found
}
beforeEach(() => {
  localStorage.clear()
  workspace.archivedSpaces = new ArchivedSpaces()
  workspace.spaces = [space('Notes'), space('Work'), space('Old'), space('Local')]
  workspace.activeSpaceId = 'Notes'
  workspace.openedArchived = null
  server.settings = {}
  server.sent.length = 0
  server.offline = false
  if (double.user?.id !== 'a') double.signInAs('a')
  workspace.leaveArchived.mockClear()
})
describe('a space put away', () => {
  test('leaves every list of spaces, and comes back where it was', async () => {
    await archive.archiveSpace(at(2))
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Work', 'Local'])
    expect(archive.archivedSpaces().map((one) => one.name)).toEqual(['Old'])
    expect(workspace.spaces).toHaveLength(4)
    await archive.unarchiveSpace(at(2))
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Work', 'Old', 'Local'])
  })
  test('is remembered by this device across a restart', async () => {
    await archive.archiveSpace(at(3))
    expect(new ArchivedSpaces().has('/spaces/Local')).toBe(true)
  })
  test('that is open is left for the one after it, or the one before at the end', async () => {
    await archive.archiveSpace(at(0))
    expect(workspace.activeSpaceId).toBe('Work')
    workspace.activeSpaceId = 'Local'
    await archive.archiveSpace(at(3))
    expect(workspace.activeSpaceId).toBe('Old')
  })
  test('is never the last one in sight', async () => {
    for (const one of workspace.spaces.slice(1)) await archive.archiveSpace(one)
    await archive.archiveSpace(at(0))
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes'])
  })
})
describe('the account', () => {
  test('hears the ids of its spaces put away, and nothing of a space only this device has', async () => {
    await archive.archiveSpace(at(2))
    await archive.archiveSpace(at(3))
    await settled()
    expect(server.settings.archivedSpaces).toEqual(['id-Old'])
  })
  test('puts away and brings back what another device did, the open space left first', async () => {
    await archive.receive({ archivedSpaces: ['id-Notes', 'id-Work'] })
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Old', 'Local'])
    expect(workspace.activeSpaceId).toBe('Old')
    expect(workspace.leaveArchived).toHaveBeenCalled()
    await archive.receive({ archivedSpaces: ['id-Work'] })
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Old', 'Local'])
  })
  test('keeps what it holds of spaces this device does not have', async () => {
    server.settings = { archivedSpaces: ['id-Elsewhere'] }
    await archive.receive({ archivedSpaces: ['id-Elsewhere'] })
    await archive.archiveSpace(at(1))
    await settled()
    expect(server.settings.archivedSpaces).toEqual(['id-Elsewhere', 'id-Work'])
  })
  test('is sent this device’s list where it changed offline, rather than undoing it', async () => {
    await archive.receive({ archivedSpaces: [] })
    server.offline = true
    await archive.archiveSpace(at(1))
    server.offline = false
    await archive.receive({ archivedSpaces: [] })
    await settled()
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Old', 'Local'])
    expect(server.settings.archivedSpaces).toEqual(['id-Work'])
  })
  test('that signed out leaves nothing of its list to the next one on the device', async () => {
    await archive.receive({ archivedSpaces: ['id-Elsewhere'] })
    server.offline = true
    await archive.archiveSpace(at(1))
    server.offline = false
    double.signInAs('b')
    await archive.unarchiveSpace(at(1))
    await archive.archiveSpace(at(2))
    await settled()
    expect(last()).toEqual({ archivedSpaces: ['id-Old'] })
  })
  test('never leaves no space in sight', async () => {
    workspace.spaces = [space('Notes'), space('Work')]
    await archive.receive({ archivedSpaces: ['id-Notes', 'id-Work'] })
    expect(workspace.shownSpaces).toHaveLength(1)
  })
})
describe('an archived space opened to look at it', () => {
  test('stays open when the account says again it is archived, and any other archived space open is still left', async () => {
    await archive.archiveSpace(at(2))
    workspace.openedArchived = 'Old'
    workspace.activeSpaceId = 'Old'
    await archive.receive({ archivedSpaces: ['id-Old'] })
    expect(workspace.activeSpaceId).toBe('Old')
    workspace.openedArchived = null
    await archive.receive({ archivedSpaces: ['id-Old'] })
    expect(workspace.activeSpaceId).toBe('Notes')
  })
})
const heardOnce = (ids: string[]) =>
  localStorage.setItem('orden:settings-heard', JSON.stringify({ who: 'a', settings: { archivedSpaces: ids } }))
describe('a space archived on one device', () => {
  test('never unarchives a space another device archived meanwhile', async () => {
    heardOnce([])
    await archive.receive({ archivedSpaces: [] })
    server.settings = { archivedSpaces: ['id-Two'] }
    server.offline = true
    await archive.archiveSpace(at(2))
    server.offline = false
    await archive.listed()
    await vi.waitFor(() => expect(server.sent.at(-1)?.archivedSpaces).toEqual(['id-Two', 'id-Old']))
    workspace.spaces = [...workspace.spaces, space('Two')]
    await archive.receive({ archivedSpaces: server.settings.archivedSpaces as string[] })
    expect(archive.archivedSpaces().map((one) => one.name)).toEqual(['Old', 'Two'])
  })
  test('nor after a reload that heard the other device first, while this one still owed its own', async () => {
    heardOnce([])
    await archive.receive({ archivedSpaces: [] })
    server.settings = { archivedSpaces: ['id-Two'] }
    server.offline = true
    await archive.archiveSpace(at(2))
    server.offline = false
    heardOnce(['id-Two'])
    await archive.listed()
    await vi.waitFor(() => expect(server.sent.at(-1)?.archivedSpaces).toEqual(['id-Two', 'id-Old']))
  })
})
