import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The store reads the browser's storage the moment it is made, and reads
 *  notes through the platform shim. Under node there is neither, so both are
 *  stood in for first - which is why the store is imported further down
 *  rather than at the top. */

const notes: Record<string, string> = {
  '/space/a.md': '# a',
  '/space/b.md': '# b',
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command !== 'read_note') return undefined

    const doc = notes[String(args?.path)]
    if (doc === undefined) throw new Error(`no such note: ${String(args?.path)}`)
    return doc
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
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

/** A single click in the file list, and the tab it lands in. */
async function preview(path: string) {
  await workspace.open(path, { preview: true })
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} did not open`)
  return tab
}

describe('keeping a preview tab', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    // Auto-save would otherwise try to write the note back a moment later.
    workspace.setAutoSave(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('a single click from the list opens a preview', async () => {
    const tab = await preview('/space/a.md')
    expect(workspace.previewTabId).toBe(tab.id)
  })

  test('an unkept preview is taken over by the next one', async () => {
    const first = await preview('/space/a.md')
    const second = await preview('/space/b.md')

    expect(second.id).toBe(first.id)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('makes the tab stay, so the next preview gets a tab of its own', async () => {
    const first = await preview('/space/a.md')
    workspace.keep(first.id)
    expect(workspace.previewTabId).toBeNull()

    const second = await preview('/space/b.md')
    expect(second.id).not.toBe(first.id)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.previewTabId).toBe(second.id)
  })

  test('leaves the preview alone when asked about some other tab', async () => {
    await workspace.open('/space/a.md')
    const permanent = workspace.tabs[0]
    const previewed = await preview('/space/b.md')

    workspace.keep(permanent.id)
    expect(workspace.previewTabId).toBe(previewed.id)
  })

  test('is what typing in the note does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

    workspace.edit('# a, changed')

    expect(keep).toHaveBeenCalledWith(tab.id)
    expect(workspace.previewTabId).toBeNull()
  })

  test('is what opening the note for real does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

    await workspace.open('/space/a.md')

    expect(keep).toHaveBeenCalledWith(tab.id)
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.tabs).toHaveLength(1)
  })
})

describe('picking a space from the rail', () => {
  test('opens a closed sidebar on the tree', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = null
    await workspace.showSpace('one')
    expect(workspace.activeSpaceId).toBe('one')
    expect(workspace.panel).toBe('tree')
  })

  test('leaves an open panel as it is', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = 'outline'
    await workspace.showSpace('one')
    expect(workspace.panel).toBe('outline')
  })
})
