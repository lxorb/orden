import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Putting whole spaces away (#352): out of every list of spaces and back where they
 *  were, the open one left first, never the last one in sight, and the account's list
 *  the same on every device - this device's own sent where it has not been heard yet. */

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

const { ArchivedSpaces } = await import('./workspace/archived-spaces.svelte')

interface Space {
  id: string
  name: string
  root: string
}

/** The workspace as far as spaces go: the list, which is open, and the store. */
const workspace = vi.hoisted(() => ({
  spaces: [] as Space[],
  activeSpaceId: null as string | null,
  archivedSpaces: null as unknown as InstanceType<typeof ArchivedSpaces>,
  get activeSpace(): Space | null {
    return this.spaces.find((one) => one.id === this.activeSpaceId) ?? null
  },
  get shownSpaces(): Space[] {
    return this.spaces.filter((one) => !this.archivedSpaces.has(one.root))
  },
  showSpace(id: string) {
    this.activeSpaceId = id
    return Promise.resolve()
  },
}))

/** The account: what it was told, and whether it answers. */
const told = vi.hoisted(() => ({ sent: [] as unknown[], fails: false }))

vi.mock('./workspace.svelte', () => ({ workspace }))
vi.mock('./account.svelte', () => ({ account: { accountToken: 'token' } }))
vi.mock('./api', () => ({
  api: {
    saveSettings: (_token: string, patch: unknown) => {
      if (told.fails) return Promise.reject(new Error('offline'))
      told.sent.push(patch)
      return Promise.resolve({ settings: {} })
    },
  },
}))
// The account's ids: a space of this device's own has none.
vi.mock('./sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) => (root === '/spaces/Local' ? null : `id-${root.slice(8)}`),
  },
}))

const archive = await import('./space-archive')

const space = (name: string): Space => ({ id: name, name, root: `/spaces/${name}` })

/** One of the workspace's spaces, by its place. */
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
  told.sent.length = 0
  told.fails = false
})

describe('a space put away', () => {
  test('leaves every list of spaces, and comes back where it was', async () => {
    await archive.archiveSpace(at(2))

    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Work', 'Local'])
    expect(archive.archivedSpaces().map((one) => one.name)).toEqual(['Old'])
    // Nothing of the space itself changes: it is still one of the spaces.
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
    expect(archive.canArchive(at(0))).toBe(false)
    await archive.archiveSpace(at(0))
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes'])
  })
})

describe('the account', () => {
  test('hears the ids of its spaces put away, and nothing of a space only this device has', async () => {
    await archive.archiveSpace(at(2))
    await archive.archiveSpace(at(3))
    expect(told.sent.at(-1)).toEqual({ archivedSpaces: ['id-Old'] })
  })

  test('puts away and brings back what another device did, the open space left first', async () => {
    await archive.receive({ archivedSpaces: ['id-Notes', 'id-Work'] })
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Old', 'Local'])
    expect(workspace.activeSpaceId).toBe('Old')

    await archive.receive({ archivedSpaces: ['id-Work'] })
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Old', 'Local'])
  })

  test('keeps what it holds of spaces this device does not have', async () => {
    await archive.receive({ archivedSpaces: ['id-Elsewhere'] })
    await archive.archiveSpace(at(1))
    expect(told.sent.at(-1)).toEqual({ archivedSpaces: ['id-Elsewhere', 'id-Work'] })
  })

  test('is sent this device’s list where it changed offline, rather than undoing it', async () => {
    told.fails = true
    await archive.archiveSpace(at(1))
    told.fails = false

    await archive.receive({ archivedSpaces: [] })
    expect(workspace.shownSpaces.map((one) => one.name)).toEqual(['Notes', 'Old', 'Local'])
    expect(told.sent.at(-1)).toEqual({ archivedSpaces: ['id-Work'] })
  })

  test('never leaves no space in sight', async () => {
    workspace.spaces = [space('Notes'), space('Work')]
    await archive.receive({ archivedSpaces: ['id-Notes', 'id-Work'] })
    expect(workspace.shownSpaces).toHaveLength(1)
  })
})
