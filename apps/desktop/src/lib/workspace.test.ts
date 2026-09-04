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
type Entry = import('./workspace.svelte').Entry

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

describe('selecting several rows', () => {
  const note = (path: string): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  const folder = (path: string, children: Entry[]): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  })

  beforeEach(() => {
    workspace.tree = folder('/space', [
      note('/space/a.md'),
      folder('/space/f', [note('/space/f/b.md'), note('/space/f/c.md')]),
      note('/space/d.md'),
    ])
    workspace.expanded = { '/space/f': true }
    workspace.clearSelection()
  })

  test('the rows shown, top to bottom, follow open folders', () => {
    expect(workspace.visibleRows()).toEqual(['/space/a.md', '/space/f', '/space/f/b.md', '/space/f/c.md', '/space/d.md'])
    workspace.expanded = {}
    expect(workspace.visibleRows()).toEqual(['/space/a.md', '/space/f', '/space/d.md'])
  })

  test('a plain pick replaces, ctrl toggles', () => {
    workspace.select('/space/a.md')
    workspace.toggleSelect('/space/d.md')
    expect(workspace.selection).toEqual(['/space/a.md', '/space/d.md'])
    workspace.toggleSelect('/space/a.md')
    expect(workspace.selection).toEqual(['/space/d.md'])
    workspace.select('/space/f')
    expect(workspace.selection).toEqual(['/space/f'])
  })

  test('shift takes everything shown between the anchor and the row', () => {
    workspace.select('/space/a.md')
    workspace.selectRange('/space/f/c.md')
    expect(workspace.selection).toEqual(['/space/a.md', '/space/f', '/space/f/b.md', '/space/f/c.md'])
    workspace.selectRange('/space/f')
    expect(workspace.selection).toEqual(['/space/a.md', '/space/f'])
  })

  test('shift without an anchor picks the row alone', () => {
    workspace.selectRange('/space/d.md')
    expect(workspace.selection).toEqual(['/space/d.md'])
  })

  test('select all and clear', () => {
    workspace.selectAll()
    expect(workspace.selection).toHaveLength(5)
    workspace.clearSelection()
    expect(workspace.selection).toEqual([])
  })

  test('a drag carries the selection only when it starts on a selected row', () => {
    workspace.select('/space/a.md')
    workspace.toggleSelect('/space/d.md')
    expect(workspace.dragPayload('/space/a.md')).toEqual(['/space/a.md', '/space/d.md'])
    expect(workspace.dragPayload('/space/f')).toEqual(['/space/f'])
  })

  test('moving several skips what a moving folder already takes along', async () => {
    const moved: string[] = []
    const spy = vi.spyOn(workspace, 'move').mockImplementation(async (from: string) => void moved.push(from))
    await workspace.moveMany(['/space/f', '/space/f/b.md', '/space/a.md'], '/space/elsewhere')
    expect(moved).toEqual(['/space/f', '/space/a.md'])
    expect(workspace.selection).toEqual([])
    spy.mockRestore()
  })

  test('deleting several knows which are folders', async () => {
    const removed: [string, boolean][] = []
    const spy = vi
      .spyOn(workspace, 'remove')
      .mockImplementation(async (path: string, isFolder: boolean) => void removed.push([path, isFolder]))
    await workspace.removeMany(['/space/f', '/space/f/c.md', '/space/d.md'])
    expect(removed).toEqual([
      ['/space/f', true],
      ['/space/d.md', false],
    ])
    spy.mockRestore()
  })

  test('the selection empties with the space', async () => {
    workspace.select('/space/a.md')
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    await workspace.selectSpace('one')
    expect(workspace.selection).toEqual([])
  })
})

describe('where a note was last looked at', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    workspace.setAutoSave(false)
  })

  test('a closed note reopens where it was', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 3, 420, 12)
    workspace.close(tab.id)
    expect(workspace.tabs.some((one) => one.path === '/space/a.md')).toBe(false)

    await workspace.open('/space/a.md')
    const again = workspace.tabs.find((one) => one.path === '/space/a.md')!
    expect(again.cursor).toBe(3)
    expect(again.scroll).toBe(420)
    expect(again.anchor).toBe(12)
  })

  test('a preview tab moving on to another note takes that note’s place', async () => {
    await workspace.open('/space/a.md', { preview: true })
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 2, 100)

    await workspace.open('/space/b.md', { preview: true })
    expect(tab.path).toBe('/space/b.md')
    expect(tab.scroll).toBeUndefined()

    await workspace.open('/space/a.md', { preview: true })
    expect(tab.path).toBe('/space/a.md')
    expect(tab.scroll).toBe(100)
    expect(tab.cursor).toBe(2)
  })

  test('the places survive a restart', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 1, 77)
    workspace.close(tab.id)

    const saved = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      positions?: Record<string, { cursor: number; scroll: number }>
    }
    expect(saved.positions?.['/space/a.md']).toMatchObject({ cursor: 1, scroll: 77 })
  })
})
