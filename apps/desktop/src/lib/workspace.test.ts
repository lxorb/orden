import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The store reads the browser's storage the moment it is made, and reads
 *  notes through the platform shim. Under node there is neither, so both are
 *  stood in for first - which is why the store is imported further down
 *  rather than at the top. */

const notes: Record<string, string> = {
  '/space/a.md': '# a',
  '/space/b.md': '# b',
  '/space/c.md': '# Quarter plan\n\ntext\n\n## Why it works\n\nmore\n',
}

/** The path an invoke was given, or an empty one: `args` is a bag of unknowns
 *  and a path that is not a string is not a path. */
const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command !== 'read_note') return undefined

    const path = pathOf(args)
    const doc = notes[path]
    if (doc === undefined) throw new Error(`no such note: ${path}`)
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
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { panesOf } = await import('./workspace/session')
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
    const [permanent] = workspace.tabs
    if (!permanent) throw new Error('opening a note left no tab')

    const previewed = await preview('/space/b.md')

    workspace.keep(permanent.id)
    expect(workspace.previewTabId).toBe(previewed.id)
  })

  test('is what saving does, even with nothing to write', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.dirty).toBe(false)

    await workspace.save()
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.tabs.map((one) => one.id)).toEqual([tab.id])
  })

  test('is what typing in the note does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

    // What a keystroke amounts to: the document changes, and it says so.
    tab.note.live.replace('# a, changed')

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
    workspace.device.expanded = { '/space/f': true }
    workspace.clearSelection()
  })

  test('the rows shown, top to bottom, follow open folders', () => {
    expect(workspace.visibleRows()).toEqual([
      '/space/a.md',
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
      '/space/d.md',
    ])
    workspace.device.expanded = {}
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
    expect(workspace.selection).toEqual([
      '/space/a.md',
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
    ])
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
    const spy = vi
      .spyOn(workspace, 'move')
      .mockImplementation(async (from: string) => void moved.push(from))
    await workspace.moveMany(['/space/f', '/space/f/b.md', '/space/a.md'], '/space/elsewhere')
    expect(moved).toEqual(['/space/f', '/space/a.md'])
    expect(workspace.selection).toEqual([])
    spy.mockRestore()
  })

  test('deleting several knows which are folders', async () => {
    const removed: [string, boolean][] = []
    const spy = vi
      .spyOn(workspace, 'remove')
      .mockImplementation(
        async (path: string, isFolder: boolean) => void removed.push([path, isFolder]),
      )
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

  test('only the notes most recently looked at are kept', () => {
    workspace.tabs = []
    // A place is stamped with the moment it was recorded, and which are the
    // newest is the whole question here.
    let clock = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => ++clock)

    let last = ''
    for (let index = 0; index < 320; index++) {
      workspace.tabs = []
      workspace.openBlank(`${index}.md`)
      const tab = workspace.tabs[0]
      if (!tab) throw new Error('the note did not open')

      tab.path = `/space/${index}.md`
      last = tab.id
      workspace.noteView(tab.id, index, index)
    }

    // The session is written on a timer; activating a tab writes it now.
    workspace.activate(last)
    now.mockRestore()

    const saved = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
      positions?: Record<string, unknown>
    }
    const kept = Object.keys(saved.positions ?? {})

    // The record outlives every tab in it, so it has to stop growing somewhere.
    expect(kept).toHaveLength(300)
    expect(kept).toContain('/space/319.md')
    expect(kept).not.toContain('/space/0.md')
  })
})

describe('opening a bookmarked heading', () => {
  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tabs = []
    workspace.goto = null
  })

  test('opens the note and asks for the line the words are on', async () => {
    await workspace.openAtHeading('c.md', 'Why it works')

    expect(workspace.active?.path).toBe('/space/c.md')
    expect(workspace.goto).toEqual({ path: '/space/c.md', line: 4 })
  })

  test('takes the anchor a link would write, not only the words', async () => {
    await workspace.openAtHeading('c.md', 'why-it-works')
    expect(workspace.goto).toEqual({ path: '/space/c.md', line: 4 })
  })

  test('leaves the note where it was when the heading has gone', async () => {
    await workspace.openAtHeading('c.md', 'Renamed since')

    expect(workspace.active?.path).toBe('/space/c.md')
    expect(workspace.goto).toBeNull()
  })
})

describe('the ids tabs are known by', () => {
  test('are never handed out twice', () => {
    workspace.tabs = []
    for (let index = 0; index < 5000; index++) workspace.openBlank()

    const ids = new Set(workspace.tabs.map((tab) => tab.id))
    expect(ids.size).toBe(workspace.tabs.length)

    workspace.tabs = []
  })
})

/** A pane beside the first one, holding `note` and nothing else. The split opens
 *  the same note in both, the way it does in the app; closing that copy leaves
 *  one note in each pane, which is what most of these tests are about. */
async function beside(note: string) {
  workspace.split('row')
  const copy = workspace.active
  await workspace.open(note)
  if (copy) workspace.close(copy.id)
}

/** One empty pane, whatever the last test left behind. */
function onePane() {
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.previewTabId = null
}

describe('a note in two panes', () => {
  beforeEach(() => {
    onePane()
    workspace.setAutoSave(false)
  })

  test('is one document, in a pane of its own', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.active
    workspace.split('row')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(2)

    const [left, right] = workspace.tabs
    // Two tabs, one document: that is the whole of it.
    expect(left?.note).toBe(right?.note)
    expect(right?.paneId).not.toBe(left?.paneId)
    expect(workspace.active?.id).not.toBe(first?.id)
  })

  test('opens the second pane where the note is being read', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.noteView(tab.id, 2, 40, 1)
    workspace.split('column')

    expect(workspace.active.cursor).toBe(2)
    expect(workspace.active.anchor).toBe(1)
  })

  test('wears one dirty mark and one place to save to', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const [left, right] = workspace.tabs
    if (!left || !right) throw new Error('the split did not happen')

    left.note.live.replace('# a, typed in one pane')

    expect(right.dirty).toBe(true)
    expect(right.doc).toBe(left.doc)
    // One note to ask about on the way out, not two.
    expect(workspace.unsaved).toHaveLength(1)
  })

  test('shows the link toggle in both panes and sets it for both', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const [first, second] = workspace.panes.all
    if (!first || !second) throw new Error('the split did not happen')

    expect(workspace.twins(first.id)).toEqual([second.id])
    workspace.toggleLink(first.id)

    expect(workspace.panes.at(first.id)?.linked).toBe(true)
    expect(workspace.panes.at(second.id)?.linked).toBe(true)
  })

  test('offers no link where the panes hold different notes', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    expect(workspace.twins(workspace.panes.focusedId)).toEqual([])
  })

  test('splits no further than a 2x2', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    workspace.split('column')
    workspace.split('row')

    expect(workspace.panes.count).toBe(3)
    expect(workspace.canSplit('row')).toBe(false)
  })
})

describe('closing what is in a pane', () => {
  beforeEach(() => {
    onePane()
    workspace.setAutoSave(false)
  })

  test('the last tab takes the pane with it', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    const beside = workspace.active
    if (!beside) throw new Error('the split did not happen')

    workspace.close(beside.id)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('the last pane stays, with a blank note in it', async () => {
    await workspace.open('/space/a.md')
    const only = workspace.active
    if (!only) throw new Error('nothing opened')

    workspace.close(only.id)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.active.path).toBeNull()
  })

  test('closing a pane closes everything in it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    const paneId = workspace.panes.focusedId

    workspace.closePane(paneId)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md'])
  })

  test('a tab dragged out of a pane closes the pane behind it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    const moving = workspace.active
    const [first] = workspace.panes.all
    if (!moving || !first) throw new Error('the split did not happen')

    workspace.dropTab(moving.id, first.id, null)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
    ])
  })
})

describe('an arrangement kept under a name', () => {
  beforeEach(() => {
    onePane()
    workspace.setAutoSave(false)
    for (const one of [...workspace.layouts.all]) workspace.layouts.remove(one.name)
  })

  test('comes back with the panes and the notes it held', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    workspace.saveLayout('two up')

    onePane()
    await workspace.open('/space/c.md')
    expect(workspace.panes.count).toBe(1)

    await workspace.useLayout('two up')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
  })

  test('keeps a note nobody has saved rather than dropping it', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('one up')

    workspace.openBlank('Untitled', '# unsaved words')
    await workspace.useLayout('one up')

    expect(workspace.tabs.some((tab) => tab.doc === '# unsaved words')).toBe(true)
  })

  test('is gone once it is deleted', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('for a moment')
    expect(workspace.layouts.all.map((one) => one.name)).toEqual(['for a moment'])

    workspace.layouts.remove('for a moment')

    expect(workspace.layouts.all).toEqual([])
    expect(workspace.layouts.of('for a moment')).toBeNull()
  })

  test('holds no words, so it shows what the notes say now', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('bare')

    const layout = workspace.layouts.of('bare')
    const drafts = layout ? panesOf(layout.frame).flatMap((one) => one.tabs) : []

    expect(drafts.map((draft) => draft.doc)).toEqual([''])
  })

  test('comes down to one pane on a phone', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    workspace.collapsePanes()

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(2)
    expect(new Set(workspace.tabs.map((tab) => tab.paneId)).size).toBe(1)
  })
})

describe('a note being read', () => {
  beforeEach(() => {
    onePane()
    workspace.setAutoSave(false)
  })

  test('starts being written in', async () => {
    await workspace.open('/space/a.md')
    expect(workspace.active?.reading).toBe(false)
  })

  test('turns over and back', async () => {
    await workspace.open('/space/a.md')

    workspace.toggleReading()
    expect(workspace.active?.reading).toBe(true)

    workspace.toggleReading()
    expect(workspace.active?.reading).toBe(false)
  })

  test('is one tab of two on the same note, not both', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.active
    workspace.split('row')
    const second = workspace.active

    expect(second?.note).toBe(first?.note)
    expect(second?.id).not.toBe(first?.id)

    if (second) workspace.toggleReading(second.id)

    expect(second?.reading).toBe(true)
    expect(first?.reading).toBe(false)
  })

  test('is not something the graph does', () => {
    workspace.openGraph()
    const graph = workspace.active

    workspace.toggleReading()

    expect(graph?.kind).toBe('graph')
    expect(graph?.reading).toBe(false)
  })

  test('goes into the arrangement, and comes back out of it', async () => {
    await workspace.open('/space/a.md')
    workspace.toggleReading()

    const layout = workspace.layout()
    const drafts = panesOf(layout.frame).flatMap((one) => one.tabs)
    expect(drafts.map((draft) => draft.reading)).toEqual([true])

    onePane()
    await workspace.applyLayout(layout)

    expect(workspace.tabs.map((tab) => tab.reading)).toEqual([true])
  })

  test('is written in again when the preview tab moves on', async () => {
    const tab = await preview('/space/a.md')
    workspace.toggleReading(tab.id)
    expect(tab.reading).toBe(true)

    await preview('/space/b.md')

    expect(tab.path).toBe('/space/b.md')
    expect(tab.reading).toBe(false)
  })

  test('keeps the place the editor left, for the editor to find again', async () => {
    await workspace.open('/space/c.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing open')

    tab.cursor = 12
    workspace.notePlace(tab.id, 240, 22)

    expect(tab.anchor).toBe(22)
    expect(tab.scroll).toBe(240)
    // The reading view has no caret to move, so the tab keeps the one it had.
    expect(tab.cursor).toBe(12)
  })

  test('hears about words typed in another pane', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing open')

    const before = tab.note.revision
    tab.note.live.replace('# a, changed')

    expect(tab.note.revision).toBeGreaterThan(before)
  })
})
