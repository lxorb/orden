import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const DRAWN =
  '{\n\t"nodes": [],\n\t"edges": [],\n\t"orden": {\n\t\t"version": 1,\n\t\t"ink": [' +
  '{ "id": "s1", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 10, 10, 0.5, 0, 0, 8] }' +
  ']\n\t}\n}\n'

const notes: Record<string, string> = {
  '/space/a.md': '# a',
  '/space/b.md': '# b',
  '/space/c.md': '# Quarter plan\n\ntext\n\n## Why it works\n\nmore\n',
  '/space/plan.canvas': DRAWN,
  '/elsewhere/outside.md': '# outside',
  '/elsewhere/beside it.md': '# beside it',
}

const OUTSIDE = '/elsewhere/outside.md'

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

const sent: { command: string; path: string; content: string }[] = []

const given: { command: string; args: Record<string, unknown> | undefined }[] = []

const copyingSeen: boolean[] = []

const holding: { write: Promise<void> | null; read: Promise<void> | null; readPath: string } = {
  write: null,
  read: null,
  readPath: '',
}

const trash: { id: string; path: string; content: string }[] = []
const disk: { tree: unknown } = { tree: undefined }

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push({
      command,
      path: pathOf(args),
      content: typeof args?.content === 'string' ? args.content : '',
    })
    given.push({ command, args })
    if (command === 'web_copy') {
      const { isCopying } = await import('./web-tab/web-data.svelte')
      copyingSeen.push(isCopying(String(args?.from).replace(/^note_/, '')))
    }

    if (command === 'file_stamp' && pathOf(args).startsWith('/elsewhere/')) {
      throw new Error(`${pathOf(args)} is outside the notes folder`)
    }
    if (command === 'write_note' && holding.write) await holding.write
    if (command === 'trash_words') {
      const id = `t${String(trash.length + 1)}`
      trash.push({ id, path: pathOf(args), content: String(args?.content) })
      return { id }
    }
    if (command === 'read_tree') return disk.tree
    if (command === 'list_trash') return trash.map((one) => ({ id: one.id }))
    if (command === 'purge_trash') {
      const at = trash.findIndex((one) => one.id === args?.id)
      if (at >= 0) trash.splice(at, 1)
      return undefined
    }
    if (command === 'read_note' && holding.read && holding.readPath === pathOf(args)) {
      await holding.read
    }
    if (command === 'path_exists') {
      const at = pathOf(args)
      return Object.keys(notes).some((one) => one === at || one.startsWith(`${at}/`))
    }
    if (command === 'trash_item') return { id: 'trashed' }
    if (command !== 'read_note') return undefined

    const path = pathOf(args)
    const doc = notes[path]
    if (doc === undefined) throw new Error(`no such note: ${path}`)
    return doc
  },
}))

const sheet = {
  asked: [] as string[],
  answer: null as string | null,
}

const BESIDE_PAPER = JSON.stringify({
  nodes: [
    {
      id: 'p1',
      type: 'file',
      file: 'paper.pdf',
      subpath: '#page=1',
      x: -397,
      y: 0,
      width: 794,
      height: 1123,
    },
  ],
  edges: [],
  orden: { version: 1, pages: [{ id: 'p1', paper: 'a4', pattern: 'blank' }] },
})

vi.mock('./prompt.svelte', () => ({
  prompt: {
    choose: (options: { title: string }) => {
      sheet.asked.push(options.title)
      return Promise.resolve(sheet.answer)
    },
  },
}))

const placing = vi.hoisted(() => ({
  asked: [] as { tab: string | null; saved: (() => void) | undefined }[],
}))

vi.mock('./save-place/door', () => ({
  askPlace: (tab?: string | null, saved?: () => void) => {
    placing.asked.push({ tab: tab ?? null, saved })
  },
  saveFront: () => undefined,
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
const { noteId } = await import('./note-id')
const { answeredCase } = await import('./platform/src/space-paths')
const { viewport } = await import('./viewport.svelte')
const { pages } = await import('./web-tab/pages.svelte')
const { agentMarks } = await import('./agent-marks.svelte')
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')
const ops = await import('./tab-strip/ops')
const { flushFirst, flushStart } = await import('./tab-strip/flush')
const { Tab } = await import('./workspace/documents.svelte')
const { isDraft } = await import('./workspace/drafts')
const { apartOf, readShortcut, readWebloc, writeShortcut } = await import('@orden/scan/shortcut')
const { STARTS_RIGHT } = await import('./workspace/panels')
const {
  shown: pad,
  toggleScratchpad,
  closeScratchpad,
  scratchFromDrawer,
} = await import('./scratchpad/is.svelte')
type Entry = import('./workspace.svelte').Entry

async function preview(path: string) {
  await workspace.open(path, { preview: true })
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} did not open`)
  return tab
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(async () => {
  holding.write = null
  holding.read = null
  await workspace.writesSettled()

  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
})

describe('keeping a preview tab', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
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

  test('is not taken over while a second pane is showing its note', async () => {
    const looking = await preview('/space/a.md')
    workspace.split('row')

    const beside = workspace.tabs.find((one) => one.id !== looking.id)
    if (!beside) throw new Error('the split did not happen')
    expect(beside.note).toBe(looking.note)

    workspace.focusPane(looking.paneId)
    const next = await preview('/space/b.md')

    expect(next.id).not.toBe(looking.id)
    expect(beside.path).toBe('/space/a.md')
    expect(looking.path).toBe('/space/a.md')
    workspace.collapsePanes()
  })

  test('leaves the preview alone when asked about some other tab', async () => {
    await workspace.open('/space/a.md')
    const [permanent] = workspace.tabs
    if (!permanent) throw new Error('opening a note left no tab')

    const previewed = await preview('/space/b.md')

    workspace.keep(permanent.id)
    expect(workspace.previewTabId).toBe(previewed.id)
  })

  test('is what Ctrl+S does, even with nothing to write', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.dirty).toBe(false)

    await workspace.writeNow()
    expect(workspace.previewTabId).toBeNull()
    expect(workspace.tabs.map((one) => one.id)).toEqual([tab.id])
  })

  test('is what typing in the note does', async () => {
    const tab = await preview('/space/a.md')
    const keep = vi.spyOn(workspace, 'keep')

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

describe('previewing every kind of file', () => {
  const SITE = '/space/site.url'
  const OTHER_SITE = '/space/other.url'
  const DECK = '/space/deck.pages'
  const PAPER = '/space/paper.pdf'
  const PAPER_PAGES = '/space/paper.pages'
  const PLANE = '/space/plan.canvas'

  async function look(path: string, opens = path) {
    await workspace.openEntry(path, { preview: true })
    const tab = workspace.tabs.find((one) => one.path === opens)
    if (!tab) throw new Error(`${path} did not open`)
    return tab
  }

  const paths = () => workspace.tabs.map((one) => one.path)

  beforeEach(() => {
    notes[SITE] = '[InternetShortcut]\r\nURL=https://example.com/\r\n'
    notes[OTHER_SITE] = '[InternetShortcut]\r\nURL=https://example.org/\r\n'
    notes[DECK] = '{}'
    notes[PAPER_PAGES] = BESIDE_PAPER
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/site.url']
    delete notes['/space/other.url']
    delete notes['/space/deck.pages']
    Reflect.deleteProperty(notes, PAPER_PAGES)
    vi.restoreAllMocks()
  })

  test('a website clicked in the list is the preview', async () => {
    const tab = await look(SITE)

    expect(tab.kind).toBe('web')
    expect(workspace.previewTabId).toBe(tab.id)
  })

  test('the next website takes its place, and the page goes with the tab', async () => {
    const forget = vi.spyOn(pages, 'forget')
    const first = await look(SITE)
    const second = await look(OTHER_SITE)

    expect(paths()).toEqual([OTHER_SITE])
    expect(workspace.previewTabId).toBe(second.id)
    expect(forget).toHaveBeenCalledWith(first.id)
  })

  test('a note takes a previewed website’s place in the strip, and the other way', async () => {
    await workspace.open('/space/a.md')
    await look(SITE)
    await workspace.open('/space/c.md')
    expect(paths()).toEqual(['/space/a.md', SITE, '/space/c.md'])

    const note = await look('/space/b.md')
    expect(paths()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.previewTabId).toBe(note.id)

    await look(OTHER_SITE)
    expect(paths()).toEqual(['/space/a.md', OTHER_SITE, '/space/c.md'])
  })

  test('a plane, a page note and a paper are previews like the rest', async () => {
    await look(PLANE)
    expect(paths()).toEqual([PLANE])

    await look(DECK)
    expect(paths()).toEqual([DECK])

    const paper = await look(PAPER, PAPER_PAGES)
    expect(paths()).toEqual([PAPER_PAGES])
    expect(workspace.previewTabId).toBe(paper.id)
  })

  test('a replaced preview is nothing the closed stack brings back', async () => {
    const record = vi.spyOn(workspace.closed, 'record')
    await look(SITE)
    await look('/space/a.md')

    expect(record).not.toHaveBeenCalled()
  })

  test('opening the website for real keeps it, the double click on its row', async () => {
    const tab = await look(SITE)
    await workspace.openEntry(SITE)

    expect(workspace.previewTabId).toBeNull()
    await look('/space/a.md')
    expect(paths()).toEqual([SITE, '/space/a.md'])
    expect(workspace.tabs[0]?.id).toBe(tab.id)
  })

  test('the same for a paper, whose page note is the tab that is kept', async () => {
    await look(PAPER, PAPER_PAGES)
    await workspace.openPdf(PAPER)

    expect(workspace.previewTabId).toBeNull()
    expect(paths()).toEqual([PAPER_PAGES])
  })

  test('an address typed into the bar keeps it', async () => {
    const tab = await look(SITE)
    await workspace.webAimed(tab, 'https://example.com/elsewhere')

    expect(workspace.previewTabId).toBeNull()
  })

  test('drawing on a previewed plane keeps it, the way typing keeps a note', async () => {
    const tab = await look(PLANE)
    tab.note.live.replace(`${DRAWN} `)

    expect(workspace.previewTabId).toBeNull()
  })
})

describe('picking a space from the switcher', () => {
  test('leaves a closed sidebar closed', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = null
    await workspace.showSpace('one')
    expect(workspace.activeSpaceId).toBe('one')
    expect(workspace.panel).toBeNull()
  })

  test('leaves an open panel as it is', async () => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.panel = 'outline'
    await workspace.showSpace('one')
    expect(workspace.panel).toBe('outline')
  })
})

describe('the two sides of the window', () => {
  beforeEach(() => {
    workspace.right = []
    workspace.rightPanel = null
    workspace.panel = null
  })

  test('start with everything on the left and no right side', () => {
    expect(workspace.right).toEqual([])
    expect(workspace.rightPanel).toBeNull()
    expect(workspace.sideOf('outline')).toBe('left')
    expect(workspace.panelsOn('left', ['tree', 'outline'])).toEqual(['tree', 'outline'])
    expect(workspace.panelsOn('right', ['tree', 'outline'])).toEqual([])
  })

  test('a panel moved over takes its open state with it', () => {
    workspace.showPanel('outline')
    expect(workspace.panel).toBe('outline')

    workspace.movePanel('outline', 'right')
    expect(workspace.sideOf('outline')).toBe('right')
    expect(workspace.panel).toBeNull()
    expect(workspace.rightPanel).toBe('outline')
  })

  test('and a panel that was not showing arrives shut', () => {
    workspace.showPanel('tree')
    workspace.movePanel('outline', 'right')

    expect(workspace.panel).toBe('tree')
    expect(workspace.rightPanel).toBeNull()
  })

  test('each side shows and shuts its own', () => {
    workspace.movePanel('outline', 'right')

    workspace.showPanel('tree')
    workspace.showPanel('outline')
    expect(workspace.openOn('left')).toBe('tree')
    expect(workspace.openOn('right')).toBe('outline')

    workspace.togglePanel('outline')
    expect(workspace.openOn('right')).toBeNull()
    expect(workspace.openOn('left')).toBe('tree')

    workspace.closePanel()
    expect(workspace.openOn('left')).toBeNull()
  })

  test('asking for the panel that is already showing leaves it showing', () => {
    workspace.showPanel('tree')
    workspace.showPanel('tree')

    expect(workspace.openOn('left')).toBe('tree')
  })

  test('and the press on a panel tab is the switch', () => {
    workspace.togglePanel('tree')
    expect(workspace.openOn('left')).toBe('tree')

    workspace.togglePanel('tree')
    expect(workspace.openOn('left')).toBeNull()
  })

  test('showing one panel over another still swaps them', () => {
    workspace.showPanel('tree')
    workspace.showPanel('outline')

    expect(workspace.openOn('left')).toBe('outline')
  })

  test('and moving the last one back leaves no right side behind', () => {
    workspace.movePanel('links', 'right')
    workspace.showPanel('links')
    expect(workspace.right).toEqual(['links'])

    workspace.movePanel('links', 'left')
    expect(workspace.right).toEqual([])
    expect(workspace.rightPanel).toBeNull()
    expect(workspace.panel).toBe('links')
  })

  test('a move to the side it is already on does nothing', () => {
    workspace.showPanel('tree')
    workspace.movePanel('tree', 'left')

    expect(workspace.right).toEqual([])
    expect(workspace.panel).toBe('tree')
  })
})

describe('the right side’s button', () => {
  beforeEach(() => {
    workspace.right = [...STARTS_RIGHT]
    workspace.rightPanel = null
    workspace.lastRight = null
    workspace.panel = null
  })

  test('opens the side on its first panel and shuts it again', () => {
    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('outline')
    expect(workspace.panel).toBeNull()

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBeNull()
  })

  test('comes back to whatever the side showed last', () => {
    workspace.showPanel('ask')
    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBeNull()

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('ask')
  })

  test('and to its first panel once that one has moved to the other side', () => {
    workspace.showPanel('links')
    workspace.movePanel('links', 'left')
    workspace.closePanel('right')

    workspace.toggleSidebar('right')
    expect(workspace.rightPanel).toBe('outline')
  })

  test('a key for a panel on the right opens it there, whichever side is open', () => {
    workspace.showPanel('tree')
    workspace.showPanel('links')

    expect(workspace.openOn('left')).toBe('tree')
    expect(workspace.openOn('right')).toBe('links')
  })
})

describe('the right side and the scratchpad take turns', () => {
  beforeEach(() => {
    workspace.right = [...STARTS_RIGHT]
    workspace.rightPanel = null
    workspace.lastRight = null
    workspace.panel = null
    pad.on = false
  })

  afterEach(() => {
    pad.on = false
  })

  test('the card over the side hides it, and the side is back as the card goes', () => {
    workspace.showPanel('outline')
    pad.show(false)
    expect(workspace.openOn('right')).toBeNull()

    pad.hide()
    expect(workspace.openOn('right')).toBe('outline')
  })

  test("a panel's own command and its tab each put the card away", () => {
    const roads = [() => workspace.showPanel('links'), () => workspace.togglePanel('links')]
    for (const road of roads) {
      workspace.rightPanel = null
      pad.show(false)
      road()
      expect(pad.on).toBe(false)
      expect(workspace.openOn('right')).not.toBeNull()
    }
  })

  test('the button over a kept panel shuts the side whole, and nothing comes back', () => {
    workspace.showPanel('ask')
    pad.show(false)
    workspace.toggleSidebar('right')
    expect(pad.on).toBe(false)
    expect(workspace.rightShows).toBeNull()
  })

  test('and opens it again on the card where the card is what it shut', () => {
    workspace.showPanel('ask')
    pad.show(false)
    workspace.toggleSidebar('right')
    workspace.toggleSidebar('right')
    expect(pad.on).toBe(true)
    expect(workspace.rightShows).toBe('scratchpad')
    workspace.toggleSidebar('right')
    expect(workspace.rightShows).toBeNull()
  })

  test('and on the panel where the panel is what it shut', () => {
    pad.show(false)
    workspace.showRight('outline')
    workspace.toggleSidebar('right')
    workspace.toggleSidebar('right')
    expect(pad.on).toBe(false)
    expect(workspace.rightShows).toBe('outline')
  })

  test('its key opens it in the side, and its Escape shuts the side whole', () => {
    workspace.showRight('ask')
    toggleScratchpad()
    expect(workspace.rightShows).toBe('scratchpad')
    closeScratchpad()
    expect(pad.on).toBe(false)
    expect(workspace.rightShows).toBeNull()
  })

  test('the drawer opens it out of the way of itself, and shuts it the same way', () => {
    workspace.panel = 'tree'
    workspace.rightPanel = 'outline'
    scratchFromDrawer()
    expect(pad.on).toBe(true)
    expect(workspace.panel).toBeNull()
    scratchFromDrawer()
    expect(pad.on).toBe(false)
    expect(workspace.rightShows).toBeNull()
  })

  test('the scratchpad is one of the side’s tabs, and a tab shows one or the other', () => {
    workspace.showRight('outline')
    workspace.showRight('scratchpad', false)
    expect(workspace.rightShows).toBe('scratchpad')
    workspace.showRight('links')
    expect(pad.on).toBe(false)
    expect(workspace.rightShows).toBe('links')
  })

  test('the card does not come back when the side shuts', () => {
    pad.show(false)
    workspace.showPanel('outline')
    workspace.closePanel('right')
    expect(pad.on).toBe(false)
    expect(workspace.openOn('right')).toBeNull()
  })

  test('the left side has nothing to do with it', () => {
    pad.show(false)
    workspace.showPanel('tree')
    workspace.toggleSidebar()
    expect(pad.on).toBe(true)
  })

  test('shutting the side under the card is nothing to shut', () => {
    workspace.showPanel('outline')
    pad.show(false)
    workspace.closePanel('right')
    pad.hide()
    expect(workspace.openOn('right')).toBe('outline')
  })

  test('a layout written with both open comes back with only the card', () => {
    workspace.rightPanel = 'outline'
    pad.on = true
    expect(workspace.openOn('right')).toBeNull()
    expect(workspace.holdablePanel).toBeNull()
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
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
      '/space/a.md',
      '/space/d.md',
    ])
    workspace.device.expanded = {}
    expect(workspace.visibleRows()).toEqual(['/space/f', '/space/a.md', '/space/d.md'])
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
    workspace.select('/space/f')
    workspace.selectRange('/space/a.md')
    expect(workspace.selection).toEqual([
      '/space/f',
      '/space/f/b.md',
      '/space/f/c.md',
      '/space/a.md',
    ])
    workspace.selectRange('/space/f/b.md')
    expect(workspace.selection).toEqual(['/space/f', '/space/f/b.md'])
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
      .spyOn(workspace, 'bin')
      .mockImplementation(async (path: string, isFolder: boolean) => {
        removed.push([path, isFolder])
        return null
      })
    await workspace.removeMany(['/space/f', '/space/f/c.md', '/space/d.md'])
    expect(removed).toEqual([
      ['/space/f', true],
      ['/space/d.md', false],
    ])
    spy.mockRestore()
  })

  test('and deleting several is one step to undo', async () => {
    const spy = vi.spyOn(workspace, 'bin').mockResolvedValue({ content: '' })
    await workspace.removeMany(['/space/a.md', '/space/d.md'])

    expect(workspace.undone.last).toEqual({
      kind: 'many',
      steps: [
        { kind: 'delete', path: '/space/a.md', content: '' },
        { kind: 'delete', path: '/space/d.md', content: '' },
      ],
    })
    expect(workspace.undoLabel).toBe('Undo the deletion')
    spy.mockRestore()
  })

  test('every picked row goes at once, waiting on saving once, even past one that will not go', async () => {
    const { failed } = await import('./views/failed.svelte')
    const told = vi.spyOn(failed, 'tell').mockImplementation(() => undefined)
    const { Saving } = await import('./workspace/saving.svelte')
    const settling = vi.spyOn(Saving.prototype, 'settled')
    let letGo: () => void = () => undefined
    const held = new Promise<void>((go) => (letGo = go))
    const binned: string[] = []
    const spy = vi.spyOn(workspace, 'bin').mockImplementation(async (path: string) => {
      binned.push(path)
      if (path === '/space/a.md') {
        await held
        throw new Error('locked')
      }
      return { content: '' }
    })
    workspace.select('/space/a.md')
    workspace.toggleSelect('/space/f')
    workspace.toggleSelect('/space/d.md')

    const going = workspace.removeMany([...workspace.selection])
    await vi.waitFor(() => expect(binned).toEqual(['/space/a.md']))
    expect(workspace.entryAt('/space/a.md')).toBeNull()
    expect(workspace.entryAt('/space/f')).toBeNull()
    expect(workspace.entryAt('/space/d.md')).toBeNull()
    expect(workspace.selection).toEqual([])

    letGo()
    await going
    expect(binned).toEqual(['/space/a.md', '/space/f', '/space/d.md'])
    expect(settling).toHaveBeenCalledTimes(1)
    expect(told).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    settling.mockRestore()
    told.mockRestore()
  })

  test('the selection empties with the space', async () => {
    workspace.select('/space/a.md')
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    await workspace.selectSpace('one')
    expect(workspace.selection).toEqual([])
  })
})

describe('nesting a note in a note', () => {
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

  const shown = (entry: Entry | null): string[] =>
    !entry
      ? []
      : entry.children.flatMap((child) => [child.path, ...shown(child.is_dir ? child : null)])

  beforeEach(() => {
    workspace.activeSpaceId = null
    workspace.tree = folder('/space', [note('/space/a.md'), note('/space/d.md')])
    workspace.device.expanded = {}
    workspace.clearSelection()
  })

  test('the note the drop landed on goes into the folder first', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')

    expect(shown(workspace.tree)).toEqual(['/space/a', '/space/a/a.md', '/space/a/d.md'])
  })

  test('and the folder is open, so the row does not swallow what was dropped', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    expect(workspace.isExpanded('/space/a')).toBe(true)
  })

  test('the note is not a row of its own: it is the row', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    workspace.device.expanded = { '/space/a': true }

    expect(workspace.visibleRows()).toEqual(['/space/a', '/space/a/d.md'])
  })

  test('and the row says it holds rows, for the arrows that fold it', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    const row = workspace.visibleTree().find((one) => one.path === '/space/a')

    expect(row).toEqual({ path: '/space/a', folder: true, open: true })
  })

  test('dragging the last row back out leaves a note and no folder', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    await workspace.moveMany(['/space/a/d.md'], '/space')

    expect(shown(workspace.shownTree)).toEqual(['/space/a.md', '/space/d.md'])
  })

  test('and asks for the folder to go only once nothing is left in it', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    sent.length = 0
    await workspace.moveMany(['/space/a/d.md'], '/space')

    expect(
      sent.filter((one) => one.command === 'remove_empty_folder').map((one) => one.path),
    ).toEqual(['/space/a'])
  })

  test('a drop that nests is one step, and undoing it takes the folder away', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    expect(workspace.undone.last).toMatchObject({
      kind: 'many',
      steps: [
        { kind: 'move', from: '/space/a.md', to: '/space/a/a.md', nests: true },
        { kind: 'move', from: '/space/d.md', to: '/space/a/d.md' },
      ],
    })

    sent.length = 0
    await workspace.undoFileAction()
    expect(
      sent
        .filter((one) => one.command === 'rename_note' || one.command === 'remove_empty_folder')
        .map((one) => one.command + ' ' + one.path),
    ).toEqual(['rename_note ', 'rename_note ', 'remove_empty_folder /space/a'])
    expect(workspace.undone.next?.kind).toBe('many')
  })

  test('and the last row dragged back out is one step with the unnesting it caused', async () => {
    await workspace.moveMany(['/space/d.md'], '/space/a')
    await workspace.moveMany(['/space/a/d.md'], '/space')

    expect(workspace.undone.last).toMatchObject({
      kind: 'many',
      steps: [
        { kind: 'move', from: '/space/a/d.md', to: '/space/d.md' },
        { kind: 'move', from: '/space/a/a.md', to: '/space/a.md', follows: true },
      ],
    })
  })

  test('a note dropped on a folder that is a folder is the plain move it always was', async () => {
    workspace.tree = folder('/space', [
      folder('/space/f', [note('/space/f/b.md')]),
      note('/space/d.md'),
    ])
    await workspace.moveMany(['/space/d.md'], '/space/f')

    expect(shown(workspace.tree)).toEqual(['/space/f', '/space/f/b.md', '/space/f/d.md'])
  })
})

describe('a file in the Essentials', () => {
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

  const shown = (entry: Entry | null): string[] =>
    !entry
      ? []
      : entry.children.flatMap((child) => [child.path, ...shown(child.is_dir ? child : null)])

  const mark = (path: string) => ({ kind: 'note' as const, path, text: '' })

  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tree = folder('/space', [
      note('/space/a.md'),
      note('/space/Board.canvas'),
      note('/space/Lecture.pages'),
      note('/space/Site.web'),
      folder('/space/f', [note('/space/f/b.md')]),
    ])
    workspace.device.expanded = { '/space/f': true }
    workspace.panel = null
    workspace.revealing = null
    for (const one of workspace.bookmarks.list) workspace.bookmarks.toggle(one)
  })

  afterEach(() => {
    for (const one of workspace.bookmarks.list) workspace.bookmarks.toggle(one)
    workspace.activeSpaceId = null
  })

  test('is in the Essentials and not in the file list as well, whatever kind it is', () => {
    for (const one of ['a.md', 'Board.canvas', 'Lecture.pages', 'Site.web', 'f/b.md']) {
      workspace.bookmarks.toggle(mark(one))
    }

    expect(shown(workspace.shownTree)).toEqual(['/space/f'])
    expect(workspace.visibleRows()).toEqual(['/space/f'])
  })

  test('and taken out of them is back in the list', () => {
    workspace.bookmarks.toggle(mark('Board.canvas'))
    expect(shown(workspace.shownTree)).not.toContain('/space/Board.canvas')

    workspace.bookmarks.toggle(mark('Board.canvas'))
    expect(shown(workspace.shownTree)).toContain('/space/Board.canvas')
  })

  test('is only left out of what is drawn: the disk and the files still hold it', () => {
    workspace.bookmarks.toggle(mark('a.md'))

    expect(shown(workspace.tree)).toContain('/space/a.md')
    expect(workspace.files.map((one) => one.path)).toContain('/space/a.md')
    expect(workspace.notes.map((one) => one.path)).toContain('/space/a.md')
  })

  test('a folder, a heading and a search kept there leave the list alone', () => {
    workspace.bookmarks.toggle({ kind: 'folder', path: 'f', text: '' })
    workspace.bookmarks.toggle({ kind: 'heading', path: 'a.md', text: 'Plan' })
    workspace.bookmarks.toggle({ kind: 'search', path: '', text: 'plan' })

    expect(shown(workspace.shownTree)).toContain('/space/f')
    expect(shown(workspace.shownTree)).toContain('/space/f/b.md')
    expect(shown(workspace.shownTree)).toContain('/space/a.md')
  })

  test('is shown where its row is when it is asked for, which is not the list', () => {
    workspace.bookmarks.toggle(mark('f/b.md'))
    workspace.revealNote('/space/f/b.md')

    expect(workspace.panel).toBe('tree')
    expect(workspace.revealing).toBeNull()
  })
})

describe('a note found in the file list', () => {
  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.device.expanded = {}
    workspace.panel = null
    workspace.revealing = null
  })

  afterEach(() => {
    workspace.activeSpaceId = null
  })

  test('unfolds the rows above it, shows the list and asks for its row', () => {
    workspace.revealNote('/space/work/plans/q3.md')

    expect(workspace.device.expanded).toEqual({ '/space/work': true, '/space/work/plans': true })
    expect(workspace.panel).toBe('tree')
    expect(workspace.revealing).toBe('/space/work/plans/q3.md')
  })

  test('a note its folder is drawn as unfolds only what holds that folder', () => {
    workspace.revealNote('/space/work/plans/plans.md')
    expect(workspace.device.expanded).toEqual({ '/space/work': true })

    workspace.device.expanded = {}
    workspace.revealNote('/space/work/work.md')
    expect(workspace.device.expanded).toEqual({})
  })

  test('a note outside the space is nowhere in the list to be found', () => {
    workspace.revealNote('/elsewhere/outside.md')

    expect(workspace.revealing).toBeNull()
    expect(workspace.panel).toBeNull()
  })

  test('and folding the list shuts the rows of this space only', () => {
    workspace.tree = {
      name: 'space',
      path: '/space',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        {
          name: 'work',
          path: '/space/work',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [
            {
              name: 'a.md',
              path: '/space/work/a.md',
              is_dir: false,
              modified: 0,
              created: 0,
              children: [],
            },
          ],
        },
      ],
    }
    workspace.device.expanded = { '/space/work': true, '/other/x': true }
    expect(workspace.unfolded).toBe(true)

    workspace.foldList()

    expect(workspace.device.expanded).toEqual({ '/other/x': true })
    expect(workspace.unfolded).toBe(false)
  })
})

describe('whether the file list has anything to fold', () => {
  const note = (path: string): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  })
  const folder = (path: string, children: Entry[]): Entry => ({
    ...note(path),
    is_dir: true,
    children,
  })
  const work = (...children: Entry[]) =>
    folder('/space', [folder('/space/work', [note('/space/work/work.md'), ...children])])
  const PLANS = folder('/space/work/plans', [note('/space/work/plans/q3.md')])

  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tree = work(PLANS, note('/space/work/plan.md'))
    workspace.device.expanded = { '/space/work': true }
  })

  afterEach(() => {
    disk.tree = undefined
    workspace.tree = null
    workspace.device.expanded = {}
    workspace.activeSpaceId = null
  })

  test('is something while a row stands open', () => {
    expect(workspace.unfolded).toBe(true)
  })

  test('and nothing once every row is shut by hand', () => {
    workspace.device.expanded = { '/space/work': true, '/space/work/plans': true }
    workspace.toggleFolder('/space/work/plans')
    workspace.toggleFolder('/space/work')

    expect(workspace.unfolded).toBe(false)
  })

  test('nor when what is open is under a row that is shut', () => {
    workspace.device.expanded = { '/space/work/plans': true }

    expect(workspace.unfolded).toBe(false)
  })

  test('nor when a folder open in it is deleted', async () => {
    await workspace.fileOps.tell({
      op: 'removed',
      path: '/space/work',
      kind: 'folder',
      root: '/space',
    })
    workspace.tree = folder('/space', [])

    expect(workspace.device.expanded).toEqual({})
    expect(workspace.unfolded).toBe(false)
  })

  test('and a folder renamed or moved stays open under its new name', async () => {
    await workspace.fileOps.tell({
      op: 'moved',
      from: '/space/work',
      to: '/space/job',
      kind: 'folder',
      root: '/space',
    })
    disk.tree = folder('/space', [
      folder('/space/job', [note('/space/job/job.md'), note('/space/job/a.md')]),
    ])
    await workspace.loadTree()

    expect(workspace.device.expanded).toEqual({ '/space/job': true })
    expect(workspace.unfolded).toBe(true)
  })

  test('nor when the open note loses its last child', async () => {
    workspace.tree = work()
    expect(workspace.unfolded).toBe(false)

    disk.tree = work()
    await workspace.loadTree()
    expect(workspace.device.expanded).toEqual({})
  })

  test('nor when another device deleted the folder and sync brought the news', async () => {
    workspace.device.expanded = { '/space/work': true, '/space/gone': true, '/other/x': true }
    disk.tree = folder('/space', [note('/space/a.md')])
    await workspace.loadTree()

    expect(workspace.device.expanded).toEqual({ '/other/x': true })
    expect(workspace.unfolded).toBe(false)
  })

  test('and a folder under a shut one is still remembered for when it opens again', async () => {
    workspace.device.expanded = { '/space/work/plans': true }
    disk.tree = work(PLANS)
    await workspace.loadTree()

    expect(workspace.device.expanded).toEqual({ '/space/work/plans': true })
    expect(workspace.unfolded).toBe(false)
    workspace.toggleFolder('/space/work')
    expect(workspace.visibleRows()).toContain('/space/work/plans/q3.md')
  })
})

describe('where a note was last looked at', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
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

  test('a fold is written down even when nothing else moved', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 3, 0, 1, 1)
    workspace.noteView(tab.id, 3, 0, 1, 1, [[1, 6]])

    expect(tab.folds).toEqual([[1, 6]])
    workspace.close(tab.id)

    await workspace.open('/space/a.md')
    expect(workspace.tabs.find((one) => one.path === '/space/a.md')?.folds).toEqual([[1, 6]])
  })

  test('the places survive a restart', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')!
    workspace.noteView(tab.id, 1, 77)
    workspace.close(tab.id)

    const saved = JSON.parse(localStorage.getItem('orden:workspace') ?? '{}') as {
      positions?: Record<string, { cursor: number; scroll: number }>
    }
    expect(saved.positions?.['/space/a.md']).toMatchObject({ cursor: 1, scroll: 77 })
  })

  test('only the notes most recently looked at are kept', () => {
    workspace.tabs = []
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

    workspace.activate(last)
    now.mockRestore()

    const saved = JSON.parse(localStorage.getItem('orden:workspace') ?? '{}') as {
      positions?: Record<string, unknown>
    }
    const kept = Object.keys(saved.positions ?? {})

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

async function beside(note: string) {
  workspace.split('row')
  const copy = workspace.active
  await workspace.open(note)
  if (copy) workspace.close(copy.id)
}

function onePane() {
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.previewTabId = null
}

describe('walking back along a trail', () => {
  beforeEach(() => {
    onePane()
  })

  test('joins the document the note is already open as', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    await workspace.open('/space/a.md')

    const kept = workspace.tabs.find((one) => one.id !== looking.id)
    if (!kept) throw new Error('the note did not open in a tab of its own')

    await workspace.walk(0, looking.id)

    expect(looking.path).toBe('/space/a.md')
    expect(looking.note).toBe(kept.note)
    expect(workspace.documentAt('/space/a.md')).toBe(kept.note)
    expect(workspace.documents.filter((one) => one.path === '/space/a.md')).toHaveLength(1)
  })

  test('and leaves the pane that shares this tab’s document where it was', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    workspace.split('row')

    const other = workspace.tabs.find((one) => one.id !== looking.id)
    if (!other) throw new Error('the split did not happen')
    expect(other.note).toBe(looking.note)

    await workspace.walk(0, looking.id)

    expect(looking.path).toBe('/space/a.md')
    expect(other.path).toBe('/space/b.md')
    expect(other.note).not.toBe(looking.note)
  })

  test('and drops a note that has gone from the disk out of the trail', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    looking.trail = ['/space/gone.md', '/space/b.md']

    await workspace.walk(0, looking.id)

    expect(looking.trail).toEqual(['/space/b.md'])
    expect(looking.path).toBe('/space/b.md')
  })
})

describe('a strip whose tabs start at its pane’s edge (#1139)', () => {
  beforeEach(() => {
    onePane()
  })

  test('is every strip but the bar’s first, with its first tab in front', async () => {
    await workspace.open('/space/a.md')
    expect(flushStart(workspace.panes.focusedId)).toBe(false)

    workspace.split('row')
    const [left, right] = workspace.panes.all
    if (!left || !right) throw new Error('the split did not happen')
    expect(flushStart(left.id)).toBe(false)
    expect(flushFirst(right.id)).toBe(true)

    workspace.panes.fills = right.id
    expect(flushStart(right.id)).toBe(false)
    workspace.panes.fills = null

    workspace.focusPane(right.id)
    await workspace.open('/space/b.md')
    expect(workspace.tabsIn(right.id)).toHaveLength(2)
    expect(flushStart(right.id)).toBe(true)
    expect(flushFirst(right.id)).toBe(false)
  })

  test('and the strip of a pane under another one', async () => {
    await workspace.open('/space/a.md')
    workspace.split('column')
    const [upper, lower] = workspace.panes.all
    if (!upper || !lower) throw new Error('the split did not happen')
    expect(flushStart(upper.id)).toBe(false)
    expect(flushFirst(lower.id)).toBe(true)
  })

  test('but not while the steps back and forward stand ahead of the tabs', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    const right = workspace.panes.all[1]
    if (!right) throw new Error('the split did not happen')
    const tab = workspace.tabsIn(right.id)[0]
    if (!tab) throw new Error('the second pane is empty')
    tab.trail = ['/space/b.md', '/space/a.md']
    expect(flushStart(right.id)).toBe(false)
  })
})

describe('a note in two panes', () => {
  beforeEach(() => {
    onePane()
  })

  test('opens to the side, leaving the pane in front on what it showed', async () => {
    await workspace.open('/space/a.md')
    const [first] = workspace.panes.all

    await workspace.openAside('/space/b.md')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.showing(first?.id ?? '')?.path).toBe('/space/a.md')
    expect(workspace.active?.path).toBe('/space/b.md')
    expect(workspace.active?.paneId).not.toBe(first?.id)
  })

  test('opens a note already open to the side as a second view of it', async () => {
    await workspace.open('/space/a.md')
    const shown = workspace.active

    await workspace.openAside('/space/a.md')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.active?.note).toBe(shown?.note)
    expect(workspace.active?.id).not.toBe(shown?.id)
  })

  test('is one document, in a pane of its own', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.active
    workspace.split('row')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(2)

    const [left, right] = workspace.tabs
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

  test('is one note and one write, whichever pane it was typed in', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const [left, right] = workspace.tabs
    if (!left || !right) throw new Error('the split did not happen')

    sent.length = 0
    left.note.live.replace('# a, typed in one pane')
    expect(right.dirty).toBe(true)

    await workspace.writesSettled()
    expect(right.doc).toBe(left.doc)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: '/space/a.md', content: '# a, typed in one pane' },
    ])
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

  test('a resize leaves the arrangement and its panes as they were', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const frame = workspace.panes.frame
    const panes = workspace.panes.all
    const split = frame.kind === 'split' ? frame : null
    if (!split) throw new Error('the split did not happen')

    workspace.panes.resize(split.id, 0.31, 1000)

    expect(workspace.panes.frame).toBe(frame)
    expect(workspace.panes.all).toEqual(panes)
    expect(split.fraction).toBeCloseTo(0.31)
  })

  test('splits off in the face the note was in, and each keeps its own', async () => {
    await workspace.open('/space/a.md')
    const [left] = workspace.tabs
    if (!left) throw new Error('nothing opened')
    left.source = true

    workspace.split('row')
    const right = workspace.active
    if (!right) throw new Error('the split did not happen')
    expect(right.source).toBe(true)

    right.source = false
    expect(left.source).toBe(true)
  })

  test('brings each pane back in its own face after a restart', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    const [left, right] = workspace.tabs
    if (!left || !right) throw new Error('the split did not happen')
    right.source = true

    const written = workspace.layout()
    onePane()
    await workspace.applyLayout(written, false)

    const [first, second] = workspace.panes.all
    expect(workspace.showing(first?.id ?? '')?.source).toBe(false)
    expect(workspace.showing(second?.id ?? '')?.source).toBe(true)
    expect(workspace.showing(first?.id ?? '')?.note).toBe(workspace.showing(second?.id ?? '')?.note)
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

  test('the last pane stays, and nothing is made to fill it', async () => {
    await workspace.open('/space/a.md')
    const only = workspace.active
    if (!only) throw new Error('nothing opened')

    workspace.close(only.id)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toEqual([])
    expect(workspace.active).toBeNull()
  })

  test('closing a pane closes everything in it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    const paneId = workspace.panes.focusedId

    await workspace.closePane(paneId)

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md'])
  })

  test('a closed pane comes back whole with one reopen, and is written once', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    await workspace.open('/space/c.md')
    const paneId = workspace.panes.focusedId
    expect(workspace.tabsIn(paneId).map((tab) => tab.path)).toEqual(['/space/b.md', '/space/c.md'])
    const writes = vi.spyOn(workspace, 'persist')

    await workspace.closePane(paneId)
    expect(writes).toHaveBeenCalledTimes(1)
    await workspace.reopenClosed()

    expect(workspace.tabs.map((tab) => tab.path).sort()).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
    writes.mockRestore()
  })

  test('a tab dragged out of a pane closes the pane behind it', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    const moving = workspace.active
    const [first] = workspace.panes.all
    if (!moving || !first) throw new Error('the split did not happen')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: first.id, zone: 'middle' })

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
    ])
  })
})

describe('a tab a session wrote as pinned', () => {
  beforeEach(() => {
    onePane()
  })

  const draft = (path: string, pinned = false) => ({
    kind: 'note' as const,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    doc: '',
    dirty: false,
    cursor: 0,
    scroll: 0,
    ...(pinned ? { pinned: true } : {}),
  })

  test('comes back where it was, with the tab that was showing still showing', async () => {
    await workspace.applyLayout({
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          active: 2,
          linked: false,
          tabs: [draft('/space/a.md'), draft('/space/b.md', true), draft('/space/c.md')],
        },
      },
      focused: 'p1',
      panel: null,
    })

    expect(workspace.tabs.map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
    expect(workspace.active?.path).toBe('/space/c.md')
    const written = JSON.stringify(workspace.layout())
    expect(written).not.toContain('pinned')
  })

  test('keeps one Settings tab when what comes back holds two', async () => {
    workspace.openUnsaved('settings', '', 'Settings')
    const kept = workspace.layout()
    if (kept.frame.kind !== 'pane') throw new Error('one pane expected')
    const [one] = kept.frame.pane.tabs
    if (!one) throw new Error('nothing kept')
    kept.frame.pane.tabs = [one, { ...one }]

    await workspace.applyLayout(kept)

    expect(workspace.tabs.filter((tab) => tab.kind === 'settings')).toHaveLength(1)
  })
})

describe('a window with nothing open', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  test('is what an arrangement whose notes have all gone leaves behind', async () => {
    await workspace.applyLayout({
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note',
              path: '/space/gone.md',
              name: 'gone.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    })

    expect(workspace.tabs).toEqual([])
    expect(workspace.active).toBeNull()
  })

  test('and closing the notes one by one never makes a new one', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    for (const tab of [...workspace.tabs]) workspace.close(tab.id)

    expect(workspace.tabs).toEqual([])
    expect(workspace.panes.count).toBe(1)
  })

  test('and the pane that stays names no tab as the one it shows', async () => {
    await workspace.open('/space/a.md')
    const [only] = workspace.tabs
    if (only) workspace.close(only.id)

    expect(workspace.activeTabId).toBeNull()
  })
})

describe('a tab dropped on another pane', () => {
  beforeEach(() => {
    onePane()
  })

  async function twoPanes() {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    await beside('/space/b.md')

    const [first, second] = workspace.panes.all
    const moving = workspace.active
    if (!first || !second || !moving) throw new Error('the split did not happen')

    return { first, second, moving }
  }

  test('lands in the strip at the place it was let go of', async () => {
    const { first, moving } = await twoPanes()
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 1 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('lands last when it was dropped past the end of the strip', async () => {
    const { first, moving } = await twoPanes()
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 2 })

    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/c.md',
      '/space/b.md',
    ])
  })

  test('is the tab showing where it lands, and gives the pane the focus', async () => {
    const { first, moving } = await twoPanes()
    workspace.openBlank()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 0 })

    expect(workspace.panes.at(first.id)?.activeTabId).toBe(moving.id)
    expect(workspace.panes.focusedId).toBe(first.id)
    expect(workspace.active?.id).toBe(moving.id)
  })

  test('takes the pane it emptied with it, and the layout closes up', async () => {
    const { first, second, moving } = await twoPanes()

    workspace.dropTab(moving.id, { kind: 'strip', paneId: first.id, at: 1 })

    expect(workspace.panes.count).toBe(1)
    expect(workspace.panes.at(second.id)).toBeNull()
    expect(workspace.panes.focusedId).toBe(first.id)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('moves along its own strip when it is dropped back into it', async () => {
    const { second, moving } = await twoPanes()
    workspace.openBlank('scratch')

    workspace.dropTab(moving.id, { kind: 'strip', paneId: second.id, at: 2 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(second.id).map((tab) => tab.name)).toEqual(['scratch', 'b.md'])
    expect(workspace.panes.at(second.id)?.activeTabId).toBe(moving.id)
  })

  test('makes the pane on the side it was held against', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'left' })

    const [left, right] = workspace.panes.all
    expect(workspace.panes.count).toBe(2)
    expect(left?.id).not.toBe(only.id)
    expect(right?.id).toBe(only.id)
    expect(workspace.tabsIn(left?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
    expect(workspace.panes.frame.kind === 'split' && workspace.panes.frame.along).toBe('row')
  })

  test('makes the pane above when it was held against the top', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'top' })

    const [above] = workspace.panes.all
    expect(above?.id).not.toBe(only.id)
    expect(workspace.tabsIn(above?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
    expect(workspace.panes.frame.kind === 'split' && workspace.panes.frame.along).toBe('column')
  })

  test('leaves the far sides where they always were', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    workspace.dropTab(moving.id, { kind: 'pane', paneId: only.id, zone: 'bottom' })

    const [above, below] = workspace.panes.all
    expect(above?.id).toBe(only.id)
    expect(workspace.tabsIn(below?.id ?? '').map((tab) => tab.path)).toEqual(['/space/c.md'])
  })
})

describe('the sides a pane offers a drop', () => {
  beforeEach(() => {
    onePane()
  })

  test('offers none to the only tab of the pane, which would undo itself', async () => {
    await workspace.open('/space/a.md')

    const [only] = workspace.panes.all
    const alone = workspace.active
    if (!only || !alone) throw new Error('nothing opened')

    expect(workspace.canLand('left', only.id, alone.id)).toBe(false)
    expect(workspace.canLand('bottom', only.id, alone.id)).toBe(false)
    expect(workspace.canLand('left', only.id, null)).toBe(true)
  })

  test('offers all four once the pane holds a second tab', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')

    const [only] = workspace.panes.all
    const moving = workspace.active
    if (!only || !moving) throw new Error('nothing opened')

    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(workspace.canLand(side, only.id, moving.id)).toBe(true)
    }
  })

  test('offers none at all once the arrangement is a 2x2', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    workspace.split('column')
    workspace.split('column', workspace.tabsIn(workspace.panes.all[0]?.id ?? '')[0]?.id)

    expect(workspace.panes.count).toBe(4)
    for (const one of workspace.panes.all) {
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(workspace.canLand(side, one.id, null)).toBe(false)
      }
    }
  })
})

describe('a note dragged out of the file list onto a pane', () => {
  beforeEach(() => {
    onePane()
  })

  test('opens in the strip it was dropped into, at that place', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')

    const [first] = workspace.panes.all
    if (!first) throw new Error('the split did not happen')

    await workspace.dropNotes(['/space/c.md'], { kind: 'strip', paneId: first.id, at: 0 })

    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(first.id).map((tab) => tab.path)).toEqual([
      '/space/c.md',
      '/space/a.md',
    ])
  })

  test('opens in a pane of its own against a side', async () => {
    await workspace.open('/space/a.md')

    const [only] = workspace.panes.all
    if (!only) throw new Error('nothing opened')

    await workspace.dropNotes(['/space/b.md'], { kind: 'pane', paneId: only.id, zone: 'top' })

    const [above, below] = workspace.panes.all
    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabsIn(above?.id ?? '').map((tab) => tab.path)).toEqual(['/space/b.md'])
    expect(workspace.tabsIn(below?.id ?? '').map((tab) => tab.path)).toEqual(['/space/a.md'])
  })
})

describe('an arrangement kept under a name', () => {
  beforeEach(() => {
    onePane()
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

  test('keeps a note whose words are not on the disk yet rather than dropping it', async () => {
    await workspace.open('/space/a.md')
    workspace.saveLayout('one up')

    onePane()
    await workspace.open('/space/b.md')
    workspace.active?.note.live.replace('# unwritten words')
    await workspace.useLayout('one up')

    expect(workspace.tabs.some((tab) => tab.doc === '# unwritten words')).toBe(true)
  })

  test('comes back from its file where the words are too many to copy', async () => {
    await workspace.open('/space/b.md')
    workspace.active?.note.live.replace(`# long\n${'x'.repeat(1_000_000)}`)

    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)

    expect(workspace.active?.dirty).toBe(true)
    expect(drafts.map((draft) => [draft.doc, draft.dirty])).toEqual([['', false]])
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

describe('a replacement across the space', () => {
  const change = (path: string, before: string, after: string) => ({
    path,
    before,
    after,
    edits: [{ from: 0, to: before.length, insert: after }],
    back: [{ from: 0, to: after.length, insert: before }],
  })

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.undone.stack = []
    sent.length = 0
  })

  test('keeps what each note said before it writes what it says now', async () => {
    await workspace.replaceInNotes([change('/space/a.md', '# a', '# alpha')])

    const written = sent.filter((one) => one.path === '/space/a.md')
    expect(written.map((one) => one.command)).toEqual(['read_note', 'snapshot_note', 'write_note'])
    expect(written[1]?.content).toBe('# a')
    expect(written[2]?.content).toBe('# alpha')
  })

  test('takes a snapshot of every note it touches', async () => {
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    expect(sent.filter((one) => one.command === 'snapshot_note').map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
    ])
  })

  test('puts the words into a note that is open, and leaves it saved', async () => {
    await workspace.open('/space/a.md')
    await workspace.replaceInNotes([change('/space/a.md', '# a', '# alpha')])

    const tab = workspace.tabs.find((one) => one.path === '/space/a.md')
    expect(tab?.doc).toBe('# alpha')
    expect(tab?.dirty).toBe(false)
  })

  test('is one thing to undo, however many notes it touched', async () => {
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    expect(workspace.undone.stack).toHaveLength(1)
    expect(workspace.undoLabel).toBe('Undo the replacement')
  })

  test('writes nothing and remembers nothing when there is nothing to change', async () => {
    await workspace.replaceInNotes([])

    expect(sent).toEqual([])
    expect(workspace.undoLabel).toBeNull()
  })

  test('undoing gives every note its old words back', async () => {
    await workspace.open('/space/a.md')
    await workspace.replaceInNotes([
      change('/space/a.md', '# a', '# alpha'),
      change('/space/b.md', '# b', '# beta'),
    ])

    sent.length = 0
    await workspace.undoFileAction()

    const written = sent.filter((one) => one.command === 'write_note')
    expect(written.map((one) => [one.path, one.content])).toEqual([
      ['/space/a.md', '# a'],
      ['/space/b.md', '# b'],
    ])

    expect(workspace.tabs.find((one) => one.path === '/space/a.md')?.doc).toBe('# a')
    expect(workspace.undone.stack).toHaveLength(0)
  })
})

describe('closing, which never asks anything', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    sheet.asked = []
    sheet.answer = 'cancel'
    sent.length = 0
  })

  async function dirty(path: string) {
    await workspace.open(path)
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)

    tab.note.live.replace(`${notes[path] ?? ''}, typed`)
    return tab
  }

  const written = () =>
    sent.filter((one) => one.command === 'write_note').map((one) => [one.path, one.content])

  test('writes what a tab was typing as it closes, and asks nothing', async () => {
    const tab = await dirty('/space/a.md')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([['/space/a.md', '# a, typed']])
    expect(workspace.tabs.some((one) => one.id === tab.id)).toBe(false)
  })

  test('closes an empty new note without a word, and writes nothing', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  test('closes a pane and everything in it, writing what was typed', async () => {
    await workspace.open('/space/a.md')
    await beside(OUTSIDE)
    const paneId = workspace.panes.focusedId
    await dirty(OUTSIDE)

    await workspace.closePane(paneId)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs.map((one) => one.path)).toEqual(['/space/a.md'])
    expect(written()).toEqual([[OUTSIDE, '# outside, typed']])
  })

  test('and the window going has nothing left to wait for once the writes are down', async () => {
    await dirty('/space/a.md')
    await dirty('/space/b.md')

    expect(workspace.writing).toBe(true)
    await workspace.writesSettled()

    expect(workspace.writing).toBe(false)
    expect(sheet.asked).toEqual([])
    expect(
      written()
        .map(([path]) => path)
        .sort(),
    ).toEqual(['/space/a.md', '/space/b.md'])
  })
})

describe('a new tab left alone', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    agentMarks.opened = {}
  })

  function leftForAnother() {
    workspace.newTab()
    const blank = workspace.active
    if (!blank) throw new Error('no new tab')
    const other = workspace.openUnsaved('note', 'words')
    return { blank, other }
  }

  const open = (id: string) => workspace.tabs.some((one) => one.id === id)

  test('goes, leaves nothing to reopen, and the tab in front stays', () => {
    const { blank, other } = leftForAnother()
    workspace.closeLeftBlank()

    expect(open(blank.id)).toBe(false)
    expect(workspace.closed.stack).toEqual([])
    expect(workspace.active).toBe(other)
  })

  test('stays while it is the one being worked in', () => {
    workspace.newTab()
    const blank = workspace.active
    workspace.closeLeftBlank()
    expect(blank && open(blank.id)).toBe(true)
  })

  test('stays with words half typed into its address field', () => {
    const { blank } = leftForAnother()
    pages.of(blank.id).halfTyped = { value: 'exam', typed: 'exam', from: 4, to: 4, over: '' }
    workspace.closeLeftBlank()
    expect(open(blank.id)).toBe(true)
  })

  test('stays once it went somewhere', () => {
    const { blank } = leftForAnother()
    workspace.webWalked(blank, 'https://www.example.com/')
    workspace.closeLeftBlank()
    expect(open(blank.id)).toBe(true)
  })

  test('stays where an agent opened it', () => {
    const { blank } = leftForAnother()
    agentMarks.opened = { [blank.id]: 'Claude' }
    workspace.closeLeftBlank()
    expect(open(blank.id)).toBe(true)
  })

  test('in front of a pane left for another goes, and the keyboard stays where it went', () => {
    workspace.openUnsaved('note', 'first').note.dirty = true
    const left = workspace.panes.focusedId
    workspace.newTab()
    const blank = workspace.active
    if (!blank) throw new Error('no new tab')
    workspace.split('row')
    const right = workspace.panes.focusedId
    workspace.openUnsaved('note', 'beside').note.dirty = true
    workspace.closeLeftBlank()

    expect(open(blank.id)).toBe(false)
    expect(workspace.tabs.filter((one) => workspace.isNewTab(one))).toEqual([])
    expect(workspace.panes.focusedId).toBe(right)
    expect(workspace.showing(left)?.doc).toBe('first')
  })

  test('stays as the only tab of a pane on screen', () => {
    workspace.openUnsaved('note', 'first').note.dirty = true
    const left = workspace.panes.focusedId
    workspace.split('row')
    const copy = workspace.active
    workspace.newTab()
    const blank = workspace.active
    if (copy) workspace.close(copy.id)
    workspace.focusPane(left)
    workspace.closeLeftBlank()
    expect(blank && open(blank.id)).toBe(true)
  })
})

describe('a new tab', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    workspace.tree = null
    sheet.asked = []
    sent.length = 0
  })

  const written = () => sent.filter((one) => one.command === 'write_note')

  test('a new plane is a tab, with nothing on disk and no row in the list', async () => {
    await workspace.newCanvas()

    expect(workspace.active?.kind).toBe('canvas')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
    expect(workspace.active?.doc).toContain('"nodes"')
    expect(workspace.active?.shown).toBe('Untitled')
  })

  test('and a new deck of pages is the same', async () => {
    await workspace.newPages()

    expect(workspace.active?.kind).toBe('pages')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
    expect(workspace.active?.shown).toBe('Untitled')
  })

  test('and a new website is a tab with no shortcut behind it', () => {
    workspace.openWebsite()

    expect(workspace.active?.kind).toBe('web')
    expect(workspace.active?.path).toBeNull()
    expect(written()).toEqual([])
  })

  test('Ctrl+T and the plus are a new tab with nowhere to go yet', () => {
    workspace.newTab()

    const tab = workspace.active
    expect(tab?.kind).toBe('web')
    expect(tab && workspace.isNewTab(tab)).toBe(true)
  })

  test('and is called New tab until it goes somewhere', () => {
    workspace.newTab()
    const tab = workspace.active
    if (!tab) throw new Error('no new tab')

    expect(tab.shown).toBe('New tab')
    tab.name = 'Website'
    expect(tab.shown).toBe('New tab')

    workspace.webWalked(tab, 'https://www.example.com/a')
    expect(tab.shown).toBe('example.com')

    workspace.webNamed(tab, 'Example Domain')
    expect(tab.shown).toBe('Example Domain')
  })

  test('and closed with nothing on it, is not brought back', async () => {
    workspace.close(workspace.openPage('https://example.com/') ?? '')
    workspace.newTab()
    workspace.close(workspace.active?.id ?? '')
    expect(workspace.closed.stack.map((one) => one.draft.address)).toEqual(['https://example.com/'])

    await workspace.reopenClosed()
    expect(workspace.tabs.map((one) => one.address)).toEqual(['https://example.com/'])
  })

  test('and a kind chosen on it takes its place in the strip, leaving nothing behind', async () => {
    await workspace.newCanvas()
    const before = workspace.active
    workspace.newTab()
    const chosenOn = workspace.active
    if (!before || !chosenOn) throw new Error('no tabs')

    workspace.chosenOn(chosenOn.id)
    workspace.openWebsite(true)

    const strip = workspace.tabsIn(workspace.panes.focusedId)
    expect(strip.map((one) => one.id)).not.toContain(chosenOn.id)
    expect(strip.map((one) => one.inPrivate)).toEqual([false, true])
    expect(strip[0]?.id).toBe(before.id)
    expect(workspace.active).toMatchObject({ inPrivate: true })
    expect(workspace.closed.stack).toEqual([])
  })

  test('but not once it has somewhere to go', () => {
    workspace.newTab()
    const chosenOn = workspace.active
    if (!chosenOn) throw new Error('no new tab')

    workspace.chosenOn(chosenOn.id)
    chosenOn.address = 'https://example.com/'
    workspace.openBlank()

    expect(workspace.tabs.map((one) => one.id)).toContain(chosenOn.id)
  })

  test('and a choice is spent by the next tab, whatever it is', () => {
    workspace.newTab()
    const chosenOn = workspace.active
    if (!chosenOn) throw new Error('no new tab')

    workspace.chosenOn(chosenOn.id)
    workspace.openBlank()
    workspace.newTab()
    const second = workspace.active
    workspace.openBlank()

    expect(workspace.tabs).toContain(second)
  })

  test('nor by a tab that opens behind it', () => {
    workspace.newTab()
    const chosenOn = workspace.active
    if (!chosenOn) throw new Error('no new tab')

    workspace.chosenOn(chosenOn.id)
    workspace.openPage('https://example.com/', 'behind')

    expect(workspace.tabs.map((one) => one.id)).toContain(chosenOn.id)
    expect(workspace.active).toBe(chosenOn)
  })

  test('yet a tab that opens behind it spends the choice all the same', () => {
    workspace.newTab()
    const chosenOn = workspace.active
    if (!chosenOn) throw new Error('no new tab')

    workspace.chosenOn(chosenOn.id)
    workspace.openPage('https://example.com/', 'behind')
    workspace.openBlank()

    expect(workspace.tabs.map((one) => one.id)).toContain(chosenOn.id)
  })

  test('and the host picker it opened, put away, gives the choice up', async () => {
    const { hostPicker } = await import('./remote/picker.svelte')
    workspace.newTab()
    const chosenOn = workspace.active
    if (!chosenOn) throw new Error('no new tab')

    workspace.chosenOn(chosenOn.id)
    hostPicker.show(chosenOn.paneId)
    hostPicker.dismiss()
    workspace.openBlank()

    expect(workspace.tabs.map((one) => one.id)).toContain(chosenOn.id)
  })

  test('and so does a tab that is already open, brought to the front instead', () => {
    const was = workspace.restored
    workspace.restored = true
    try {
      workspace.openSettings()
      workspace.newTab()
      const chosenOn = workspace.active
      if (!chosenOn) throw new Error('no new tab')

      workspace.chosenOn(chosenOn.id)
      workspace.openSettings()
      workspace.activate(chosenOn.id)
      workspace.openBlank()

      expect(workspace.tabs.filter((one) => one.kind === 'settings')).toHaveLength(1)
      expect(workspace.tabs.map((one) => one.id)).toContain(chosenOn.id)
    } finally {
      workspace.restored = was
    }
  })

  test('a tablet draws no page: a link and a new web tab make no tab there', () => {
    const was = viewport.device
    try {
      viewport.device = 'tablet'
      workspace.openBlank()
      expect(workspace.openPage('https://example.com/')).toBeNull()
      workspace.openWebsite()
      workspace.newTab()
      expect(workspace.tabs.some((one) => one.kind === 'web')).toBe(false)

      viewport.device = 'desktop'
      expect(workspace.openPage('https://example.com/')).not.toBeNull()
      workspace.openWebsite()
      expect(workspace.tabs.filter((one) => one.kind === 'web')).toHaveLength(2)
    } finally {
      viewport.device = was
    }
  })

  test('a phone has no web tab, so a new tab there is the kinds in the pane itself', () => {
    const was = viewport.device
    viewport.device = 'phone'
    try {
      workspace.openBlank()
      workspace.newTab()

      expect(workspace.active).toBeNull()
      expect(workspace.tabs.some((one) => one.kind === 'web')).toBe(false)
    } finally {
      viewport.device = was
    }
  })

  test('a note stays a tab with no file however much is written, and asks nothing', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')

    tab.note.live.replace('# Weekly review\n\nwords')
    await vi.advanceTimersByTimeAsync(2500)
    await workspace.writesSettled()

    expect(tab.path).toBeNull()
    expect(written()).toEqual([])
    expect(sheet.asked).toEqual([])
    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)
    expect(drafts[0]?.doc).toBe('# Weekly review\n\nwords')
  })

  test('saved, is a file where it is put, under the name given, in the same tab', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Weekly review\n\nwords')

    const saved = await workspace.save(tab, '/space', 'Review.md')

    expect(saved).toBe('/space/Review.md')
    expect(workspace.active).toBe(tab)
    expect(tab.path).toBe('/space/Review.md')
    expect(written().map((one) => [one.path, one.content])).toEqual([
      ['/space/Review.md', '# Weekly review\n\nwords'],
    ])
  })

  test('saved with nothing said, goes to the root of the space it was opened in', async () => {
    workspace.spaces = [
      { id: 's', name: 'Notes', root: '/space' },
      { id: 't', name: 'Other', root: '/other' },
    ]
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Weekly review')
    workspace.activeSpaceId = 't'

    await workspace.save(tab)

    expect(tab.path).toBe('/space/Weekly review.md')
  })

  test('that arrives with words is a file at once, under the name it came with', async () => {
    workspace.openBlank('Report', '# Quarterly\n\nwords')
    await vi.advanceTimersByTimeAsync(0)
    await workspace.writesSettled()

    expect(workspace.active?.path).toBe('/space/Report.md')
    expect(written().map((one) => one.path)).toEqual(['/space/Report.md'])
  })

  test('never writes over a file the folder already has', async () => {
    workspace.tree = {
      name: 'space',
      path: '/space',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        { name: 'W.md', path: '/space/W.md', is_dir: false, modified: 0, created: 0, children: [] },
      ],
    }
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('W')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/W 2.md')
    workspace.tree = null
  })

  test('a plane saved is written as it stands, as Untitled', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/Untitled.canvas')
    expect(written().map((one) => one.path)).toEqual(['/space/Untitled.canvas'])
  })

  test('closes without a word while nothing has been drawn on it, and leaves nothing', async () => {
    await workspace.newCanvas()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.close(tab.id)
    await workspace.writesSettled()

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
    expect(written()).toEqual([])
    expect(workspace.closed.any).toBe(false)
  })

  test('closed with words asks nothing, and keeps them for Ctrl+Shift+T and Recently deleted', async () => {
    trash.length = 0
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Plan\n\nwords')

    workspace.close(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.at(-1)?.trashed).toBe('t1'))

    expect(sheet.asked).toEqual([])
    expect(written()).toEqual([])
    expect(trash).toEqual([{ id: 't1', path: '/space/Plan.md', content: '# Plan\n\nwords' }])

    await workspace.reopenClosed()

    const back = workspace.tabs.at(-1)
    expect(back?.doc).toBe('# Plan\n\nwords')
    expect(back?.path).toBeNull()
    expect(trash).toEqual([])
  })

  test('restored from Recently deleted, is not reopened as well', async () => {
    trash.length = 0
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace('# Plan')
    workspace.close(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.at(-1)?.trashed).toBe('t1'))

    trash.length = 0
    await workspace.reopenClosed()

    expect(workspace.tabs).toEqual([])
  })

  test('while a website closes without a question either way', () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.close(tab.id)

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  test('a website is saved as a shortcut holding the address it is on', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.com/a'
    pages.of(tab.id).title = 'Example: the page'

    await workspace.writeNow()
    expect(written()).toEqual([])

    await workspace.save(tab)

    const wrote = written()
    expect(wrote.map((one) => one.path)).toEqual(['/space/Example the page.url'])
    expect(wrote[0]!.content).toContain('URL=https://example.com/a')
    expect(tab.path).toBe('/space/Example the page.url')
  })

  test('and under the name and in the place given', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.com/a'

    await workspace.save(tab, '/space/Reading', 'Later.url')

    expect(tab.path).toBe('/space/Reading/Later.url')
    expect(written()[0]!.content).toContain('Title=Later')
  })

  test('never lands two websites on one file', async () => {
    workspace.openWebsite()
    const first = workspace.active
    workspace.openWebsite()
    const second = workspace.active
    if (!first || !second || first.id === second.id) throw new Error('two tabs did not open')

    first.address = 'https://example.com/a'
    second.address = 'https://example.com/b'
    pages.of(first.id).title = 'Example'
    pages.of(second.id).title = 'Example'

    await Promise.all([workspace.save(first), workspace.save(second)])

    expect(first.path).toBe('/space/Example.url')
    expect(second.path).toBe('/space/Example 2.url')
    expect(workspace.documentAt('/space/Example.url')).toBe(first.note)
    expect(written().map((one) => one.path)).toEqual(['/space/Example.url', '/space/Example 2.url'])
  })

  test('a website saved twice from one tab is one file', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    pages.of(tab.id).title = 'Example'

    await Promise.all([workspace.save(tab), workspace.save(tab)])

    expect(written().map((one) => one.path)).toEqual(['/space/Example.url'])
  })

  test('a website kept under the name of a web note on its own site is that note', async () => {
    notes['/space/Example.url'] =
      '[InternetShortcut]\r\nURL=https://www.example.com/\r\nTitle=Example\r\nOrden-Added=2026-09-01T00:00:00.000Z\r\nOrden-Icon=data:kept\r\n'
    try {
      workspace.openWebsite()
      const tab = workspace.active
      if (!tab) throw new Error('nothing opened')
      tab.address = 'https://example.com/b'

      await workspace.save(tab, '/space', 'Example.url')

      expect(tab.path).toBe('/space/Example.url')
      const wrote = written()[0]!.content
      expect(wrote).toContain('URL=https://example.com/b')
      expect(wrote).toContain('Orden-Added=2026-09-01T00:00:00.000Z')
      expect(wrote).toContain('Orden-Icon=data:kept')
    } finally {
      delete notes['/space/Example.url']
    }
  })

  test('a tab with its note’s own web data is saved Separate, under an id of its own', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.org/b'
    tab.apart = '0123456789abcdef'
    const before = written().length
    try {
      await workspace.save(tab, '/space', 'Apart.url')
      const wrote = written()[before]!.content
      expect(wrote).toMatch(/Orden-Data=[0-9a-f]{16}/)
      expect(wrote).not.toContain('Orden-Data=0123456789abcdef')
      const own = /Orden-Data=([0-9a-f]{16})/.exec(wrote)![1]!
      const copy = sent.findIndex((one) => one.command === 'web_copy')
      const write = sent.findIndex(
        (one) => one.command === 'write_note' && one.path === '/space/Apart.url',
      )
      expect(copy).toBeGreaterThanOrEqual(0)
      expect(copy).toBeLessThan(write)
      expect(given.find((one) => one.command === 'web_copy')?.args).toEqual({
        from: 'note_0123456789abcdef',
        into: `note_${own}`,
        origins: ['https://example.org'],
      })
      expect(copyingSeen).toEqual([true])
      const { isCopying } = await import('./web-tab/web-data.svelte')
      expect(isCopying('0123456789abcdef')).toBe(false)
    } finally {
      delete notes['/space/Apart.url']
    }
  })

  test('a tab with web data of its own saved over a Global note leaves it Global', async () => {
    notes['/space/Global.url'] =
      '[InternetShortcut]\r\nURL=https://example.org/\r\nTitle=Global\r\n'
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.address = 'https://example.org/b'
    tab.apart = '0123456789abcdef'
    const before = written().length
    try {
      await workspace.save(tab, '/space', 'Global.url')
      const wrote = written()[before]!
      expect(wrote.path).toBe('/space/Global.url')
      expect(wrote.content).not.toContain('Orden-Data')
    } finally {
      delete notes['/space/Global.url']
    }
  })

  test('an untouched one comes back after a restart', async () => {
    await workspace.newPages()

    const drafts = panesOf(workspace.layout().frame).flatMap((one) => one.tabs)
    expect(drafts[0]?.doc.length).toBeGreaterThan(0)
  })
})

describe('closing a tab with unsaved words', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.closed.stack = []
    trash.length = 0
    sheet.asked = []
    sheet.answer = null
    placing.asked = []
  })

  function draft(words: string) {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no blank tab')
    tab.note.live.replace(words)
    return tab
  }

  const open = (id: string) => workspace.tabs.some((one) => one.id === id)

  test('asks before it goes, and Cancel keeps it with its words', async () => {
    const tab = draft('# Plan\n\nwords')

    await workspace.closeAsking(tab.id)

    expect(sheet.asked).toEqual([`Save changes to ${tab.shown}?`])
    expect(open(tab.id)).toBe(true)
    expect(tab.note.blank).toBe(false)
    expect(trash).toEqual([])
  })

  test('Don’t save closes it, its words in Recently deleted and on the closed stack', async () => {
    const tab = draft('# Plan\n\nwords')
    sheet.answer = 'discard'

    await workspace.closeAsking(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.at(-1)?.trashed).toBe('t1'))

    expect(open(tab.id)).toBe(false)
    expect(trash).toEqual([{ id: 't1', path: '/space/Plan.md', content: '# Plan\n\nwords' }])
  })

  test('Save asks where, keeps the tab until it is saved, and then closes it', async () => {
    const tab = draft('# Plan\n\nwords')
    sheet.answer = 'save'

    await workspace.closeAsking(tab.id)
    await vi.waitFor(() => expect(placing.asked).toHaveLength(1))

    expect(placing.asked[0]?.tab).toBe(tab.id)
    expect(open(tab.id)).toBe(true)

    await workspace.save(tab, '/space', 'Plan.md')
    placing.asked[0]?.saved?.()
    await vi.waitFor(() => expect(open(tab.id)).toBe(false))
    expect(sheet.asked).toHaveLength(1)
    expect(trash).toEqual([])
  })

  test('several close with one question, and Save gives each its file first', async () => {
    const one = draft('# One')
    const two = draft('# Two')
    sheet.answer = 'save'

    await workspace.closeMany([one.id, two.id])

    expect(sheet.asked).toEqual(['Save changes to these tabs?'])
    expect(open(one.id) || open(two.id)).toBe(false)
    expect(trash).toEqual([])
    expect(sent.filter((call) => call.command === 'write_note').map((call) => call.path)).toEqual(
      expect.arrayContaining(['/space/One.md', '/space/Two.md']),
    )
  })

  test('asks nothing of an empty new tab, a note with a file, or a website', async () => {
    workspace.openBlank()
    const empty = workspace.active
    await workspace.open('/space/a.md')
    const note = workspace.tabs.find((one) => one.path === '/space/a.md')
    workspace.openWebsite()
    const site = workspace.active
    if (!empty || !note || !site) throw new Error('nothing opened')
    note.note.live.replace('# a, typed')

    await workspace.closeMany([empty.id, note.id, site.id])

    expect(sheet.asked).toEqual([])
    expect(workspace.tabs).toEqual([])
  })
})

describe('a note writes itself, wherever it is', () => {
  const WELCOME = '/Notes/Read me.md'

  beforeEach(() => {
    vi.useFakeTimers()
    onePane()
    workspace.spaces = [
      { id: 's', name: 'Notes', root: '/space' },
      { id: 'w', name: 'Read me', root: '/Notes' },
    ]
    workspace.activeSpaceId = 's'
    sheet.asked = []
    sheet.answer = 'cancel'
    sent.length = 0
    notes[WELCOME] = '# Welcome to Nib'
  })

  afterEach(async () => {
    await workspace.writesSettled()
    vi.useRealTimers()
  })

  async function typedIn(path: string) {
    await workspace.open(path)
    const tab = workspace.tabs.find((one) => one.path === path)
    if (!tab) throw new Error(`${path} did not open`)

    tab.note.live.replace(`${notes[path] ?? ''}, typed`)
    return tab
  }

  const written = () => sent.filter((one) => one.command === 'write_note').map((one) => one.path)

  test('a note deleted straight after typing is on the disk when its snapshot is read', async () => {
    await typedIn('/space/a.md')

    await workspace.remove('/space/a.md', false)

    const about = sent.filter((one) => one.path === '/space/a.md').map((one) => one.command)
    expect(about.indexOf('write_note')).toBeGreaterThanOrEqual(0)
    expect(about.lastIndexOf('write_note')).toBeLessThan(about.lastIndexOf('read_note'))
  })

  test('a delete does not wait for ever on a write that never comes back', async () => {
    await typedIn('/space/a.md')
    const gate = { free: () => undefined as unknown }
    holding.write = new Promise<void>((resolve) => {
      gate.free = () => {
        resolve()
      }
    })

    const deleting = workspace.remove('/space/a.md', false)
    await vi.advanceTimersByTimeAsync(5_000)
    await deleting

    expect(sent.map((one) => one.command)).toContain('trash_item')
    holding.write = null
    gate.free()
  })

  test('a note in a space goes down well inside a second of the typing pausing', async () => {
    const tab = await typedIn('/space/a.md')

    await vi.advanceTimersByTimeAsync(400)

    expect(written()).toEqual(['/space/a.md'])
    expect(tab.dirty).toBe(false)
  })

  test('signing out changes nothing about it: a space is a space', async () => {
    await typedIn(WELCOME)

    await vi.advanceTimersByTimeAsync(400)

    expect(written()).toEqual([WELCOME])
    expect(workspace.outside(WELCOME)).toBe(false)
  })

  test('a file typed in while it was being written is written again', async () => {
    const tab = await typedIn('/space/a.md')

    let release: () => void = () => undefined
    holding.write = new Promise<void>((resolve) => {
      release = resolve
    })

    const writing = workspace.writeNow()
    await vi.advanceTimersByTimeAsync(0)
    tab.note.live.edit([{ from: 0, to: 0, insert: 'typed during the write\n' }])
    release()
    await writing
    holding.write = null

    expect(tab.dirty).toBe(false)
    expect(written()).toEqual(['/space/a.md', '/space/a.md'])
  })

  test('Ctrl+S stays harmless: it writes at once and keeps the preview tab', async () => {
    const tab = await preview('/space/a.md')
    tab.note.live.replace('# a, typed')

    await workspace.writeNow()

    expect(written()).toEqual(['/space/a.md'])
    expect(workspace.previewTabId).toBeNull()
    expect(sheet.asked).toEqual([])
  })

  test('a rename during a write waits for it, and one file is left, with the words', async () => {
    const tab = await typedIn('/space/c.md')

    let release: () => void = () => undefined
    holding.write = new Promise<void>((resolve) => {
      release = resolve
    })

    const writing = workspace.writeNow()
    await vi.advanceTimersByTimeAsync(0)
    const renaming = workspace.rename('/space/c.md', 'Renamed.md')
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.some((one) => one.command === 'rename_note')).toBe(false)

    release()
    await Promise.all([writing, renaming])
    holding.write = null

    const order = sent
      .filter((one) => one.command === 'write_note' || one.command === 'rename_note')
      .map((one) => one.command)
    expect(order).toEqual(['write_note', 'rename_note'])
    expect(tab.path).toBe('/space/Renamed.md')
  })

  test('file recovery is offered a version of every note with a file', async () => {
    await typedIn('/space/a.md')
    await typedIn(OUTSIDE)
    workspace.openBlank()

    expect(workspace.worthKeeping.map((one) => one.path)).toEqual(['/space/a.md', OUTSIDE])
    expect(workspace.worthKeeping.every((one) => one.revision > 0)).toBe(true)
  })

  test('and no version of a note nobody has written in', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.worthKeeping.map((one) => one.revision)).toEqual([0])
  })
})

describe('reopening the tab that was closed last', () => {
  beforeEach(() => {
    onePane()
    workspace.closed.stack = []
    sheet.asked = []
    sheet.answer = 'discard'
    sent.length = 0
  })

  test('brings the note back where the focus is once its pane has gone', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')
    await workspace.open('/space/b.md')

    const beside = workspace.active
    if (!beside) throw new Error('the split did not happen')

    workspace.close(beside.id)
    await workspace.reopenClosed()

    expect(workspace.tabs.map((one) => one.path)).toContain('/space/b.md')
  })

  test('puts it back at its own place in the strip', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    await workspace.open('/space/c.md')

    const middle = workspace.tabs[1]
    if (!middle) throw new Error('three notes did not open')

    workspace.close(middle.id)
    await workspace.reopenClosed()

    expect(workspace.tabs.map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])
  })

  test('brings back what was typed a moment before it closed', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# a, typed just now')

    workspace.close(tab.id)
    await workspace.reopenClosed()

    expect(workspace.active.doc).toBe('# a, typed just now')
    await workspace.writesSettled()
  })

  test('remembers nothing about the blank page a window starts with', async () => {
    workspace.openBlank()
    await workspace.open('/space/a.md')

    expect(workspace.closed.any).toBe(false)
  })

  test('reaches past a note that has since gone', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    const [first, second] = workspace.tabs
    if (!first || !second) throw new Error('two notes did not open')

    workspace.close(first.id)
    workspace.close(second.id)
    const kept = notes['/space/b.md'] ?? ''
    delete notes['/space/b.md']

    try {
      await workspace.reopenClosed()
      expect(workspace.tabs.map((one) => one.path)).toContain('/space/a.md')
      expect(workspace.closed.any).toBe(false)
    } finally {
      notes['/space/b.md'] = kept
    }
  })

  test('becomes a second view when the note is still open elsewhere', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const beside = workspace.active
    const first = workspace.tabs[0]
    if (!beside || !first) throw new Error('the split did not happen')

    await workspace.open('/space/b.md')
    workspace.close(beside.id)
    await workspace.reopenClosed()

    const back = workspace.tabs.find((one) => one.id !== first.id && one.note === first.note)
    expect(back?.paneId).toBe(beside.paneId)
  })

  test('and only shows it where its pane has gone and the strip left already holds it', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    const beside = workspace.active
    const first = workspace.tabs[0]
    if (!beside || !first) throw new Error('the split did not happen')

    workspace.close(beside.id)
    await workspace.reopenClosed()

    expect(workspace.tabs).toEqual([first])
    expect(workspace.active).toBe(first)
  })
})

describe('the welcome note, once there are real notes', () => {
  const WELCOME = '/Notes/Read me.md'

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    notes[WELCOME] = '# Welcome to Nib'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    notes[WELCOME] = ''
  })

  function listing(paths: string[]) {
    vi.spyOn(workspace, 'notes', 'get').mockReturnValue(
      paths.map((path) => ({ path, name: path.split('/').pop() ?? path })) as never,
    )
  }

  test('is stepped off once the account has brought notes down', async () => {
    listing([WELCOME, '/space/a.md', '/space/b.md'])
    await workspace.open(WELCOME)
    expect(workspace.tabs).toHaveLength(1)

    await workspace.leaveTheWelcomeNote()

    expect(workspace.active?.path).not.toBe(WELCOME)
    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(false)
  })

  test('stays when it is the only note there is', async () => {
    listing([WELCOME])

    await workspace.open(WELCOME)
    await workspace.leaveTheWelcomeNote()

    expect(workspace.active?.path).toBe(WELCOME)
  })

  test('stays when somebody has written in it', async () => {
    listing([WELCOME, '/space/a.md'])
    await workspace.open(WELCOME)
    const opened = workspace.tabs.find((one) => one.path === WELCOME)
    if (opened) opened.dirty = true

    await workspace.leaveTheWelcomeNote()

    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(true)
  })

  test('stays when something else is open beside it', async () => {
    listing([WELCOME, '/space/a.md'])
    await workspace.open(WELCOME)
    await workspace.open('/space/a.md')

    await workspace.leaveTheWelcomeNote()

    expect(workspace.tabs.some((one) => one.path === WELCOME)).toBe(true)
  })
})

describe('a canvas that comes back after a restart', () => {
  function drafted(kind: 'note' | 'canvas' | 'pdf', path: string) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind,
              path,
              name: path.slice(path.lastIndexOf('/') + 1),
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
  })

  test('is filled from its file, the way a note is', async () => {
    await workspace.applyLayout(drafted('canvas', '/space/plan.canvas'))

    const tab = workspace.tabs.find((one) => one.path === '/space/plan.canvas')
    expect(tab?.kind).toBe('canvas')
    expect(tab?.note.text).toBe(DRAWN)
    expect(tab?.note.dirty).toBe(false)
  })

  test('keeps a plane that was drawn on and never saved', async () => {
    const held = drafted('canvas', '/space/plan.canvas')
    const [only] = held.frame.pane.tabs
    if (!only) throw new Error('the draft holds no tab')

    only.doc = '{ "nodes": [], "edges": [] }\n'
    only.dirty = true
    await workspace.applyLayout(held)

    const tab = workspace.tabs.find((one) => one.path === '/space/plan.canvas')
    expect(tab?.note.text).toBe('{ "nodes": [], "edges": [] }\n')
    expect(tab?.note.dirty).toBe(true)
  })

  test('a paper from an older sitting comes back as its page note', async () => {
    notes['/space/paper.pages'] = BESIDE_PAPER

    try {
      await workspace.applyLayout(drafted('pdf', '/space/paper.pdf'))

      expect(workspace.tabs.find((one) => one.path === '/space/paper.pdf')).toBeUndefined()
      const tab = workspace.tabs.find((one) => one.path === '/space/paper.pages')
      expect(tab?.kind).toBe('pages')
      expect(tab?.note.dirty).toBe(false)
    } finally {
      delete notes['/space/paper.pages']
    }
  })

  test('and the session keeps no second copy of a plane that is on disk', async () => {
    await workspace.openCanvas('/space/plan.canvas')

    const written = JSON.parse(localStorage.getItem('orden:workspace') ?? '{}') as {
      layout?: { frame: { pane?: { tabs?: { path: string | null; doc: string }[] } } }
    }
    const held = written.layout?.frame.pane?.tabs?.find((one) => one.path === '/space/plan.canvas')

    expect(held).toBeDefined()
    expect(held?.doc).toBe('')
  })
})

describe('a tab on a file outside every space, after the update', () => {
  function drafted(tabs: { kind: 'note' | 'pdf'; path: string; dirty?: boolean }[]) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: tabs.map(({ kind, path, dirty = false }) => ({
            kind,
            path,
            name: path.slice(path.lastIndexOf('/') + 1),
            doc: dirty ? '# typed' : '',
            dirty,
            cursor: 0,
            scroll: 0,
          })),
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
  })

  test('is left out quietly, and the rest of the sitting comes back', async () => {
    notes['/config/custom.css'] = 'body {}'
    await workspace.applyLayout(
      drafted([
        { kind: 'note', path: OUTSIDE },
        { kind: 'note', path: '/space/a.md' },
        { kind: 'note', path: '/elsewhere/beside it.md', dirty: true },
        { kind: 'pdf', path: '/elsewhere/paper.pdf' },
        { kind: 'note', path: '/config/custom.css' },
      ]),
      false,
    )

    expect(workspace.tabs.map((one) => one.path)).toEqual(['/space/a.md', '/config/custom.css'])
    const touched = sent.filter((one) => one.path.startsWith('/elsewhere/'))
    expect(touched.map((one) => one.command)).not.toContain('read_note')
    expect(touched.map((one) => one.command)).not.toContain('write_note')
  })
})

describe('a panel asked for while the session is still arriving', () => {
  function drafted(panel: 'tree' | 'search' | null) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path: '/space/a.md',
              name: 'a.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.panel = null
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
  })

  test('is what stays, rather than what the arrangement said', async () => {
    workspace.panel = 'tree'

    let release: () => void = () => undefined
    holding.readPath = '/space/a.md'
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })

    const arriving = workspace.applyLayout(drafted('tree'), false)
    await Promise.resolve()
    await Promise.resolve()

    workspace.showPanel('search')

    release()
    await arriving

    expect(workspace.panel).toBe('search')
  })

  test('and an arrangement nobody interrupted still opens its own', async () => {
    await workspace.applyLayout(drafted('tree'), false)

    expect(workspace.panel).toBe('tree')
  })

  test('an arrangement chosen by name brings its own sidebar', async () => {
    workspace.showPanel('search')
    expect(workspace.panel).toBe('search')

    await workspace.applyLayout(drafted('tree'))

    expect(workspace.panel).toBe('tree')
  })
})

describe('a note opened while the session is still arriving', () => {
  function drafted(path: string) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path,
              name: path.slice(path.lastIndexOf('/') + 1),
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  test('stays open, and stays the one in front', async () => {
    await workspace.open('/space/b.md')
    expect(workspace.active?.path).toBe('/space/b.md')

    await workspace.applyLayout(drafted('/space/a.md'), false)

    expect(workspace.tabs.map((tab) => tab.path)).toContain('/space/b.md')
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('is not opened twice when the session holds it too', async () => {
    await workspace.open('/space/a.md')
    await workspace.applyLayout(drafted('/space/a.md'), false)

    expect(workspace.tabs.filter((tab) => tab.path === '/space/a.md')).toHaveLength(1)
    expect(workspace.active?.path).toBe('/space/a.md')
  })

  test('but an arrangement chosen by name still replaces what is open', async () => {
    await workspace.open('/space/b.md')

    await workspace.applyLayout(drafted('/space/a.md'))

    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md'])
  })
})

describe('the note a window comes back on', () => {
  function drafted(active: number) {
    return {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active,
          linked: false,
          tabs: ['/space/a.md', '/space/b.md'].map((path) => ({
            kind: 'note' as const,
            path,
            name: path.slice(path.lastIndexOf('/') + 1),
            doc: '',
            dirty: false,
            cursor: 0,
            scroll: 0,
          })),
        },
      },
      focused: 'p1',
      panel: null,
    }
  }

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  test('is the one the session says was showing, not the first in the strip', async () => {
    await workspace.applyLayout(drafted(1), false)

    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('and the one a saved arrangement names, when that is what was chosen', async () => {
    await workspace.open('/space/c.md')

    await workspace.applyLayout(drafted(1))

    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('survives being written down and read back, which is what a restart is', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    const written = workspace.layout()

    onePane()

    await workspace.applyLayout(written, false)

    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('is the first in the strip only where the pane was left showing nothing', async () => {
    await workspace.open('/space/c.md')
    workspace.active?.note.live.replace('# unwritten words')

    const empty = drafted(0)
    empty.frame.pane.tabs = []
    await workspace.applyLayout(empty)

    expect(workspace.active?.doc).toBe('# unwritten words')
  })
})

describe('what a document is called on screen', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
  })

  test('is a note without its extension', async () => {
    await workspace.open('/space/a.md')
    expect(workspace.active?.shown).toBe('a')
  })

  test('is a canvas without its extension, the way a note is', async () => {
    await workspace.openCanvas('/space/plan.canvas')
    expect(workspace.active?.shown).toBe('plan')
  })

  test('is the page note a paper opens', async () => {
    notes['/space/paper.pages'] = BESIDE_PAPER

    try {
      await workspace.openPdf('/space/paper.pdf')
      expect(workspace.active?.path).toBe('/space/paper.pages')
      expect(workspace.active?.shown).toBe('paper')
    } finally {
      delete notes['/space/paper.pages']
    }
  })

  test('is a draft first heading, so two drafts are two names', () => {
    workspace.openBlank()
    const first = workspace.active
    workspace.openBlank()
    const second = workspace.active
    if (!first || !second) throw new Error('the drafts did not open')

    first.note.live.replace('# Groceries\n\nmilk\n')
    second.note.live.replace('notes from the call\n')

    expect(first.shown).toBe('Groceries')
    expect(second.shown).toBe('notes from the call')
  })

  test('follows the words as they are typed, without waiting for a flush', () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')

    tab.note.live.replace('# Half a th')
    expect(tab.shown).toBe('Half a th')

    tab.note.live.replace('# Half a thought')
    expect(tab.shown).toBe('Half a thought')
  })

  test('is Untitled only while the draft says nothing', () => {
    workspace.openBlank()
    expect(workspace.active?.shown).toBe('Untitled')
  })

  test('reads a fixed amount of a draft, however long its first line is', () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')

    tab.note.live.replace(`${'word '.repeat(600)}\n# Buried\n`)

    expect(tab.shown).not.toBe('Buried')
    expect(tab.shown.startsWith('word word')).toBe(true)
  })

  test('is the name a draft came with, where it came with one', () => {
    workspace.openBlank('Report', '# Something else entirely\n')
    expect(workspace.active?.shown).toBe('Report')
  })

  test('is its file name once the draft is saved, and the new one once renamed', async () => {
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('the draft did not open')
    tab.note.live.replace('# A draft: first\n')
    expect(tab.shown).toBe('A draft: first')

    await workspace.save(tab)

    expect(tab.path).toBe('/space/A draft first.md')
    expect(tab.shown).toBe('A draft first')

    await workspace.rename('/space/A draft first.md', 'Kept.md')
    expect(tab.shown).toBe('Kept')
  })
})

describe('a click in the file list landing inside a gesture that re-reads the notes', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
  })

  test('does not land the note it came from in the note it moved to', async () => {
    const tab = await preview('/space/a.md')
    expect(tab.note.text).toBe('# a')

    let release: () => void = () => undefined
    holding.readPath = '/space/a.md'
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })

    const renaming = workspace.rename('/space/c.md', 'renamed.md')
    await Promise.resolve()
    await Promise.resolve()

    const moved = await preview('/space/b.md')
    expect(moved.id).toBe(tab.id)
    expect(moved.note.path).toBe('/space/b.md')

    release()
    await renaming

    expect(moved.note.path).toBe('/space/b.md')
    expect(moved.note.text).toBe('# b')
    expect(moved.note.dirty).toBe(false)
  })
})

describe('a new file stepping aside from a name the folder already has', () => {
  const row = (path: string, children?: Entry[]): Entry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: children !== undefined,
    modified: 0,
    created: 0,
    children: children ?? [],
  })

  beforeEach(() => {
    workspace.tabs = []
    workspace.activeTabId = null
    workspace.previewTabId = null
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
  })

  async function madeIn(folder: string, named: string) {
    sent.length = 0
    await workspace.createNote(folder, named)
    return sent.find((one) => one.command === 'write_note')?.path
  }

  test('takes the number in front of the extension', async () => {
    workspace.tree = row('/space', [row('/space/Plan.md')])
    expect(await madeIn('/space', 'Plan.md')).toBe('/space/Plan 2.md')
  })

  test('and a dot-file keeps the whole of its name', async () => {
    workspace.tree = row('/space', [row('/space/.hidden')])
    expect(await madeIn('/space', '.hidden')).toBe('/space/.hidden 2')
  })

  test('and a folder with a dot in its name keeps its own', async () => {
    workspace.tree = row('/space', [row('/space/v1.2', [row('/space/v1.2/Note')])])
    expect(await madeIn('/space/v1.2', 'Note')).toBe('/space/v1.2/Note 2')
  })

  test('and a note named after the moment reads the same rule', async () => {
    const taken = `${noteId('YYYY')}.md`
    workspace.tree = row('/space', [row(`/space/${taken}`)])

    sent.length = 0
    await workspace.createUniqueNote('YYYY', '/space')

    expect(sent.find((one) => one.command === 'write_note')?.path).toBe(
      `/space/${noteId('YYYY')} 2.md`,
    )
  })
})

describe('following a link to a note the space has not got', () => {
  const asked = (target: string) => ({
    path: null,
    target,
    heading: null,
    block: null,
    page: null,
  })

  beforeEach(() => {
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.tabs = []
    sent.length = 0
  })

  afterEach(() => {
    delete notes['/space/.github/CONTRIBUTING.md']
  })

  test('makes it where the link would look for it', async () => {
    await workspace.followLink(asked('Plan'))
    expect(sent.find((one) => one.command === 'write_note')?.path).toBe('/space/Plan.md')
  })

  test('beside the note the link is in, or at the top for a path from the top', async () => {
    await workspace.followLink(asked('Road'), 'plain', '/space/B/x.md')
    expect(sent.find((one) => one.command === 'write_note')?.path).toBe('/space/B/Road.md')

    sent.length = 0
    workspace.tabs = []
    await workspace.followLink(asked('/Road'), 'plain', '/space/B/x.md')
    expect(sent.find((one) => one.command === 'write_note')?.path).toBe('/space/Road.md')
  })

  test('opens a note the index never read, and writes nothing over it', async () => {
    notes['/space/.github/CONTRIBUTING.md'] = '# How to contribute\n\nWhat the team wrote.\n'
    await workspace.followLink(asked('.github/CONTRIBUTING'))

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/space/.github/CONTRIBUTING.md'])
  })

  test('and writes nothing at all for a link that climbs out of the space', async () => {
    for (const target of [
      '../../../.bashrc',
      '..\\..\\Desktop\\evil',
      'notes/../../x',
      'C:/Windows/System32/x',
      'NUL',
    ]) {
      sent.length = 0
      workspace.tabs = []
      await workspace.followLink(asked(target))

      expect(sent, target).toEqual([])
      expect(workspace.tabs, target).toEqual([])
    }
  })
})

describe('a pane that lays its notes out as columns', () => {
  test('starts as every pane starts, which is one document with a strip over it', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.stacked()).toBe(false)
    expect(workspace.panes.all[0]?.stacked).toBe(false)
  })

  test('has nothing to stack while it holds one note', async () => {
    await workspace.open('/space/a.md')

    expect(workspace.canStack()).toBe(false)
  })

  test('and offers it once it holds two', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')

    expect(workspace.canStack()).toBe(true)
    workspace.toggleStacked()
    expect(workspace.stacked()).toBe(true)
    workspace.toggleStacked()
    expect(workspace.stacked()).toBe(false)
  })

  test('per pane, so the other one is left as it was', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    workspace.split('row')

    const [first, second] = workspace.panes.all
    if (!first || !second) throw new Error('the split did not happen')

    workspace.toggleStacked(first.id)

    expect(workspace.stacked(first.id)).toBe(true)
    expect(workspace.stacked(second.id)).toBe(false)
  })

  test('and never on a machine that holds one document', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/b.md')
    expect(workspace.canStack()).toBe(true)

    viewport.device = 'phone'
    expect(workspace.canStack()).toBe(false)
    viewport.device = 'desktop'
  })
})

describe('two opens of one path', () => {
  function held(path: string): () => void {
    let release: () => void = () => undefined
    holding.readPath = path
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  }

  const over = (path: string) => workspace.documents.filter((one) => one.path === path)

  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
    workspace.tabs = []
  })

  test('are one open, and come to one document', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    expect(over('/space/a.md')).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('the same for a website, which is the tab Emil was switching away from', async () => {
    notes['/space/site.url'] = '[InternetShortcut]\r\nURL=https://example.com/\r\n'
    try {
      const release = held('/space/site.url')
      const both = Promise.all([
        workspace.openWeb('/space/site.url'),
        workspace.openWeb('/space/site.url'),
      ])
      release()
      await both

      expect(over('/space/site.url')).toHaveLength(1)
    } finally {
      delete notes['/space/site.url']
    }
  })

  test('and for a plane', async () => {
    const release = held('/space/plan.canvas')
    const both = Promise.all([
      workspace.openCanvas('/space/plan.canvas'),
      workspace.openCanvas('/space/plan.canvas'),
    ])
    release()
    await both

    expect(over('/space/plan.canvas')).toHaveLength(1)
  })

  test('one of them from a session still being read', async () => {
    const drafted = {
      frame: {
        kind: 'pane' as const,
        pane: {
          id: 'p1',
          active: 0,
          linked: false,
          tabs: [
            {
              kind: 'note' as const,
              path: '/space/a.md',
              name: 'a.md',
              doc: '',
              dirty: false,
              cursor: 0,
              scroll: 0,
            },
          ],
        },
      },
      focused: 'p1',
      panel: null,
    }

    const release = held('/space/a.md')
    const arriving = workspace.applyLayout(drafted, false)
    await Promise.resolve()
    const clicked = workspace.open('/space/a.md')
    release()
    await Promise.all([arriving, clicked])

    expect(over('/space/a.md')).toHaveLength(1)
  })

  test('so words arriving for the file reach every pane showing it', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    workspace.reload('/space/a.md', '# a, from elsewhere')
    workspace.flush()

    for (const note of over('/space/a.md')) {
      expect(note.text).toBe('# a, from elsewhere')
      expect(note.dirty).toBe(false)
    }
  })

  test('and one file is one room, because it is one document', async () => {
    const release = held('/space/a.md')
    const both = Promise.all([workspace.open('/space/a.md'), workspace.open('/space/a.md')])
    release()
    await both

    const keys = workspace.openNotes.filter((one) => one.path === '/space/a.md')
    expect(keys).toHaveLength(1)
  })
})

describe('a file that changes its name', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/renamed.md']
  })

  test('takes its document with it', async () => {
    await workspace.open('/space/a.md')
    const note = workspace.documentAt('/space/a.md')
    expect(note).not.toBeNull()

    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')

    expect(workspace.documentAt('/space/a.md')).toBeNull()
    expect(workspace.documentAt('/space/renamed.md')).toBe(note)
  })

  test('takes its bookmark with it, and an undo takes it back', async () => {
    const mark = (path: string) => ({ kind: 'note' as const, path, text: '' })
    workspace.bookmarks.toggle(mark('a.md'))

    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')
    expect(workspace.bookmarks.has(mark('renamed.md'))).toBe(true)
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(false)

    await workspace.undoFileAction()
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(true)

    await workspace.move('/space/a.md', '/space/deep')
    expect(workspace.bookmarks.has(mark('deep/a.md'))).toBe(true)

    await workspace.undoFileAction()
    expect(workspace.bookmarks.has(mark('a.md'))).toBe(true)
    workspace.bookmarks.toggle(mark('a.md'))
  })

  test('so opening it again under that name opens what is open', async () => {
    await workspace.open('/space/a.md')
    notes['/space/renamed.md'] = notes['/space/a.md'] ?? ''
    await workspace.rename('/space/a.md', 'renamed.md')

    await workspace.open('/space/renamed.md')

    expect(workspace.documents.filter((one) => one.path === '/space/renamed.md')).toHaveLength(1)
  })
})

describe('a file asked for as a note and then as a website', () => {
  const WEB_NOTE = '/space/site.md'

  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    notes[WEB_NOTE] = '---\nurl: https://example.com/\n---\n\n# The site\n'
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/site.md']
  })

  test('is one document, and the open one is what comes forward', async () => {
    await workspace.open(WEB_NOTE)
    const note = workspace.documentAt(WEB_NOTE)
    sent.length = 0

    await workspace.openWeb(WEB_NOTE)

    expect(workspace.documents.filter((one) => one.path === WEB_NOTE)).toHaveLength(1)
    expect(workspace.documentAt(WEB_NOTE)).toBe(note)
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

describe('an address typed into a website bar', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/Docs.webloc']
    delete notes['/space/Docs.url']
  })

  const aimedAt = async (path: string, was: string, url: string) => {
    notes[path] = was
    await workspace.openWeb(path)
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    sent.length = 0
    await workspace.webAimed(tab, url)
    return sent.find((one) => one.command === 'write_note')?.content
  }

  test('keeps a .webloc a plist, with nothing in it changed but the address', async () => {
    const plist = (url: string) =>
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n' +
      `\t<key>Name</key>\n\t<string>Docs</string>\n\t<key>URL</key>\n\t<string>${url}</string>\n` +
      '</dict>\n</plist>\n'

    const written = await aimedAt(
      '/space/Docs.webloc',
      plist('https://svelte.dev/'),
      'https://a.example/?a=1&b=2',
    )

    expect(written).toBe(plist('https://a.example/?a=1&amp;b=2'))
    expect(readWebloc(written)).toBe('https://a.example/?a=1&b=2')
  })

  test('and a .url an internet shortcut', async () => {
    const written = await aimedAt(
      '/space/Docs.url',
      '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n',
      'https://svelte.dev/docs',
    )

    expect(readShortcut(written)?.url).toBe('https://svelte.dev/docs')
  })
})

describe('a website the app writes', () => {
  const LINKING = '/space/One.md'

  beforeEach(async () => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    void startup.shown()
    await links.build('/space')
    links.noteSaved(LINKING, 'see [[Docs]] and [[Docs.url]]')
  })

  afterEach(() => {
    workspace.tabs = []
    links.noteGone(LINKING)
    startup.reset()
  })

  const linkedFrom = (path: string) => links.backlinks(path).map((one) => one.path)

  test('is linked the moment the file list makes it', async () => {
    await workspace.createWebsite('/space', 'Docs.url')

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
  })

  test('and is linked once its bar is aimed somewhere', async () => {
    notes['/space/Docs.url'] = '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n'
    await workspace.openWeb('/space/Docs.url')
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    expect(links.fileNamed('Docs.url')).toBeNull()

    await workspace.webAimed(tab, 'https://svelte.dev/docs')

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
    delete notes['/space/Docs.url']
  })

  test('and is linked once a tab nobody had kept is saved', async () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    tab.address = 'https://svelte.dev/'
    pages.of(tab.id).title = 'Docs'

    await workspace.save(tab)

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(linkedFrom('/space/Docs.url')).toEqual(['One.md', 'One.md'])
    links.noteGone('/space/Docs.url')
  })
})

describe('a preview landing on a note that is already open', () => {
  beforeEach(() => {
    workspace.tabs = []
    workspace.previewTabId = null
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
  })

  test('brings that note forward rather than taking it on', async () => {
    await workspace.open('/space/a.md')
    const first = workspace.documentAt('/space/a.md')

    const previewed = await preview('/space/b.md')
    await workspace.open('/space/a.md', { preview: true })

    expect(workspace.documents.filter((one) => one.path === '/space/a.md')).toHaveLength(1)
    expect(workspace.documentAt('/space/a.md')).toBe(first)
    expect(previewed.path).toBe('/space/b.md')
  })
})

describe('what a tab s own menu does to the strip', () => {
  const entry = (path: string, children: Entry[] = [], isDir = false): Entry => ({
    name: path.split('/').pop() ?? path,
    path,
    is_dir: isDir,
    modified: 0,
    created: 0,
    children,
  })

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)

  async function opened(...paths: string[]): Promise<(path: string) => string> {
    for (const path of paths) await workspace.open(path)

    return (path: string) => {
      const tab = workspace.tabs.find((one) => one.path === path)
      if (!tab) throw new Error(`${path} is not open`)
      return tab.id
    }
  }

  test('closes the tabs to the right of one, and leaves it in front', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')

    await workspace.closeAround(id('/space/a.md'), 'right')

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.active?.path).toBe('/space/a.md')
  })

  test('closes every tab of the strip', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')

    await workspace.closeAround(id('/space/c.md'), 'all')

    expect(strip()).toEqual([])
  })

  test('says how many tabs each close would take', async () => {
    const id = await opened('/space/a.md', '/space/b.md', '/space/c.md')

    expect(workspace.closesAround(id('/space/c.md'), 'right')).toBe(0)
    expect(workspace.closesAround(id('/space/a.md'), 'right')).toBe(2)
    expect(workspace.closesAround(id('/space/a.md'), 'all')).toBe(3)
  })

  test('duplicates a tab right after it, on the same document and the same place', async () => {
    const id = await opened('/space/a.md', '/space/b.md')
    const original = workspace.tabs.find((one) => one.id === id('/space/a.md'))
    if (!original) throw new Error('nothing opened')
    workspace.noteView(original.id, 2, 40, 1)

    ops.duplicateTab(original.id)

    expect(strip()).toEqual(['/space/a.md', '/space/a.md', '/space/b.md'])
    const copy = workspace.active
    expect(copy?.id).not.toBe(original.id)
    expect(copy?.note).toBe(original.note)
    expect(copy?.cursor).toBe(2)
  })

  test('does not duplicate the graph, which is one to a pane', () => {
    workspace.openGraph()
    const graph = workspace.active
    if (!graph) throw new Error('no graph')

    ops.duplicateTab(graph.id)

    expect(workspace.tabs).toHaveLength(1)
  })

  test.each(['settings', 'pass', 'time'] as const)(
    'does not duplicate the %s tab, which there is only one of',
    (kind) => {
      workspace.openUnsaved(kind, '', kind)
      const one = workspace.active
      if (!one) throw new Error('nothing opened')

      expect(workspace.canDuplicateTab(one)).toBe(false)
      ops.duplicateTab(one.id)

      expect(workspace.tabs.filter((tab) => tab.kind === kind)).toHaveLength(1)
    },
  )

  test('does not duplicate the chat, which there is only one of', () => {
    workspace.openChat()
    const chat = workspace.active
    if (!chat) throw new Error('no chat')

    ops.duplicateTab(chat.id)

    expect(workspace.tabs.filter((tab) => tab.kind === 'chat')).toHaveLength(1)
  })

  test.each(['settings', 'pass', 'time'] as const)(
    'splitting the %s tab leaves it the only one',
    (kind) => {
      workspace.openUnsaved(kind, '', kind)
      const one = workspace.active
      if (!one) throw new Error('nothing opened')

      workspace.split('row', one.id)

      expect(workspace.tabs.filter((tab) => tab.kind === kind)).toHaveLength(1)
    },
  )

  test('reopening a closed chat while another is open brings that one to the front', async () => {
    await workspace.open('/space/a.md')
    workspace.openChat()
    const first = workspace.active
    if (!first) throw new Error('no chat')
    workspace.closeEach([first.id])
    workspace.openChat()
    const second = workspace.active

    await workspace.reopenClosed()

    expect(workspace.tabs.filter((tab) => tab.kind === 'chat')).toHaveLength(1)
    expect(workspace.active).toBe(second)
  })

  test('moves a tab into a new pane beside its own when there is no other', async () => {
    const id = await opened('/space/a.md', '/space/b.md')

    ops.moveToOtherPane(id('/space/b.md'))

    expect(workspace.panes.count).toBe(2)
    const [left, right] = workspace.panes.all
    expect(workspace.tabsIn(left?.id ?? '').map((tab) => tab.path)).toEqual(['/space/a.md'])
    expect(workspace.tabsIn(right?.id ?? '').map((tab) => tab.path)).toEqual(['/space/b.md'])
    expect(workspace.panes.focusedId).toBe(right?.id)
  })

  test('moves a tab into the other pane, and the pane it leaves empty goes', async () => {
    const id = await opened('/space/a.md', '/space/b.md')
    ops.moveToOtherPane(id('/space/b.md'))

    ops.moveToOtherPane(id('/space/b.md'))

    expect(workspace.panes.count).toBe(1)
    expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
  })

  test('does not move the only tab of the only pane anywhere', async () => {
    const id = await opened('/space/a.md')

    expect(workspace.canMoveToOtherPane(id('/space/a.md'))).toBe(false)
    ops.moveToOtherPane(id('/space/a.md'))
    expect(workspace.panes.count).toBe(1)
  })

  test('renames on the file s own row, with the file list out and its folder open', async () => {
    workspace.tree = entry(
      '/space',
      [entry('/space/a.md'), entry('/space/f', [entry('/space/f/b.md')], true)],
      true,
    )
    workspace.closePanel('left')
    notes['/space/f/b.md'] = '# b'
    const id = await opened('/space/f/b.md')

    ops.renameFromTab(id('/space/f/b.md'))

    expect(workspace.openOn(workspace.sideOf('tree'))).toBe('tree')
    expect(workspace.isExpanded('/space/f')).toBe(true)
    expect(workspace.naming?.path).toBe('/space/f/b.md')
    workspace.cancelNaming()
  })

  test('renames a folder s own note on the folder s row', async () => {
    workspace.tree = entry(
      '/space',
      [entry('/space/f', [entry('/space/f/f.md'), entry('/space/f/c.md')], true)],
      true,
    )
    notes['/space/f/f.md'] = '# f'
    const id = await opened('/space/f/f.md')

    ops.renameFromTab(id('/space/f/f.md'))

    expect(workspace.naming?.path).toBe('/space/f')
    workspace.cancelNaming()
  })

  test('offers no rename for a file with no row in the list', async () => {
    workspace.tree = entry('/space', [entry('/space/a.md')], true)
    await opened(OUTSIDE)
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    expect(workspace.canRenameFromTab(tab)).toBe(false)
  })
})

describe('a tab asked for with a modifier', () => {
  const strip = () => workspace.tabs.map((one) => one.path ?? one.address)
  const jump = (path: string) => ({ path, target: path, heading: null, block: null, page: null })

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  afterEach(() => {
    workspace.tabs = []
  })

  test('behind opens it beside the tab in front, and leaves that tab in front', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { activate: false, beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
    expect(workspace.previewTabId).toBeNull()
  })

  test('a run of them from one tab keeps the order they were asked for in', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { activate: false, beside: true })
    await workspace.openEntry('/space/plan.canvas', { activate: false, beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/plan.canvas', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
  })

  test('in front opens it beside the tab and goes there', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    await workspace.openEntry('/space/b.md', { beside: true })

    expect(strip()).toEqual(['/space/a.md', '/space/b.md', '/space/c.md'])
    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('a tab left behind closes no blank note, which may be the one being read', async () => {
    workspace.openBlank()
    await workspace.openEntry('/space/b.md', { activate: false, beside: true })

    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.active?.path).toBeNull()
  })

  test('a link to a note followed with the modifier opens it behind', async () => {
    await workspace.open('/space/a.md')
    const reading = workspace.active

    await workspace.followLink(jump('b.md'), 'behind')

    expect(strip()).toEqual(['/space/a.md', '/space/b.md'])
    expect(workspace.active).toBe(reading)
  })

  test('a link to a note followed with Alt as well opens it in a pane to the right', async () => {
    await workspace.open('/space/a.md')
    const [first] = workspace.panes.all

    await workspace.followLink(jump('b.md'), 'aside')

    expect(workspace.panes.count).toBe(2)
    expect(workspace.showing(first?.id ?? '')?.path).toBe('/space/a.md')
    expect(workspace.active?.path).toBe('/space/b.md')
    expect(workspace.active?.paneId).not.toBe(first?.id)
  })

  test('and makes the note there when the space has none by that name', async () => {
    await workspace.open('/space/a.md')
    notes['/space/New.md'] = '# New\n\n'

    try {
      await workspace.followLink({ ...jump('New.md'), path: null, target: 'New' }, 'aside')

      expect(workspace.panes.count).toBe(2)
      expect(workspace.active?.path).toBe('/space/New.md')
    } finally {
      delete notes['/space/New.md']
    }
  })

  test('a paper followed the same way opens behind too, as its page note', async () => {
    notes['/space/paper.pages'] = BESIDE_PAPER
    await workspace.open('/space/a.md')
    const reading = workspace.active

    try {
      await workspace.followLink({ ...jump('paper.pdf'), page: 2 }, 'behind')

      expect(strip()).toEqual(['/space/a.md', '/space/paper.pages'])
      expect(workspace.active).toBe(reading)
    } finally {
      delete notes['/space/paper.pages']
    }
  })

  test('a page a link opened behind lands beside the tab it was pressed in', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    workspace.openPage('https://example.com/', 'behind')

    expect(strip()).toEqual(['/space/a.md', 'https://example.com/', '/space/c.md'])
    expect(workspace.activeTabId).toBe(reading.id)
  })

  test('a page a page asked for lands beside that page, even one not in front', async () => {
    await workspace.open('/space/a.md')
    const asking = workspace.openPage('https://example.com/')
    await workspace.open('/space/c.md')
    const reading = workspace.active

    workspace.openPage('https://example.org/', 'behind', asking ?? undefined)

    expect(strip()).toEqual([
      '/space/a.md',
      'https://example.com/',
      'https://example.org/',
      '/space/c.md',
    ])
    expect(workspace.active).toBe(reading)
  })

  test('a plain page still goes to the end and in front, as it did', async () => {
    await workspace.open('/space/a.md')
    await workspace.open('/space/c.md')
    const reading = workspace.tabs.find((one) => one.path === '/space/a.md')
    if (!reading) throw new Error('a.md did not open')
    workspace.activate(reading.id)

    workspace.openPage('https://example.com/')

    expect(strip()).toEqual(['/space/a.md', '/space/c.md', 'https://example.com/'])
    expect(workspace.active?.address).toBe('https://example.com/')
  })

  test('the back arrow with the middle button opens the step behind', async () => {
    const looking = await preview('/space/a.md')
    await preview('/space/b.md')
    workspace.keep(looking.id)

    workspace.goBack(looking.id, 'behind')
    await vi.waitFor(() => expect(workspace.tabs).toHaveLength(2))

    expect(strip()).toEqual(['/space/b.md', '/space/a.md'])
    expect(workspace.active?.id).toBe(looking.id)
    expect(looking.path).toBe('/space/b.md')
  })
})

describe('the space a tab belongs to', () => {
  const WORK = { id: 'w', name: 'Work', root: '/work' }
  const HOME = { id: 'h', name: 'Home', root: '/space' }

  beforeEach(() => {
    onePane()
    workspace.spaces = [HOME, WORK]
    workspace.activeSpaceId = 'w'
  })

  afterEach(() => {
    delete notes['/work/Mail.url']
  })

  test('is the space a web tab was opened in, kept when another is opened', () => {
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')

    workspace.activeSpaceId = 'h'

    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('and comes back with it after a restart', async () => {
    workspace.openWebsite()
    const layout = workspace.layout()
    expect(panesOf(layout.frame)[0]?.tabs[0]?.space).toBe('w')

    workspace.activeSpaceId = 'h'
    onePane()
    await workspace.applyLayout(layout)

    const tab = workspace.tabs[0]
    if (!tab) throw new Error('nothing came back')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('is, for a web note, the space holding its file, whichever is on screen', async () => {
    notes['/work/Mail.url'] = '[InternetShortcut]\r\nURL=https://mail.example.com/\r\n'
    workspace.activeSpaceId = 'h'

    await workspace.openWeb('/work/Mail.url')

    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('is, for a page opened out of a tab, that tab’s space', () => {
    workspace.openWebsite()
    const from = workspace.active
    if (!from) throw new Error('nothing opened')
    workspace.activeSpaceId = 'h'

    const opened = workspace.openPage('https://example.com/', 'front', from.id)

    const tab = workspace.tabs.find((one) => one.id === opened)
    if (!tab) throw new Error('the page did not open')
    expect(workspace.spaceOf(tab.note)).toBe('w')
  })

  test('is, for a new note, where it is saved to', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# Plan')
    workspace.activeSpaceId = 'h'

    await workspace.save(tab)

    expect(tab.path).toBe('/work/Plan.md')
  })
})

describe('a web note', () => {
  const SITE = '/space/Site.url'

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    notes[SITE] = '[InternetShortcut]\r\nURL=https://example.com/start\r\n'
  })

  afterEach(() => {
    delete notes['/space/Site.url']
  })

  const onSite = () => workspace.tabs.filter((one) => one.path === SITE)

  async function openSite() {
    await workspace.openWeb(SITE)
    const tab = workspace.active
    if (tab?.path !== SITE) throw new Error('the site did not open')
    pages.of(tab.id).url = 'https://example.com/deep'
    tab.address = 'https://example.com/deep'
    return tab
  }

  test('opened again shows the tab it is in, wherever that is', async () => {
    const tab = await openSite()
    await workspace.open('/space/a.md')
    workspace.split('row')

    await workspace.openWeb(SITE)
    await workspace.openEntry(SITE, { beside: true })
    await workspace.openAside(SITE)

    expect(onSite()).toEqual([tab])
    expect(workspace.active).toBe(tab)
  })

  test('duplicated is an unsaved web tab at the page it is on, with no dot', async () => {
    const tab = await openSite()

    ops.duplicateTab(tab.id)

    expect(onSite()).toEqual([tab])
    const copy = workspace.tabs.find((one) => one !== tab)
    expect(copy?.kind).toBe('web')
    expect(copy?.path).toBeNull()
    expect(copy?.address).toBe('https://example.com/deep')
    expect(copy && isDraft(copy.note)).toBe(false)
    expect(copy && workspace.spaceOf(copy.note)).toBe('s')
  })

  test('split is the same: a web tab of its own beside it', async () => {
    const tab = await openSite()

    workspace.split('row', tab.id)

    expect(onSite()).toEqual([tab])
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.tabs.find((one) => one !== tab)?.address).toBe('https://example.com/deep')
  })

  test('is one tab however a second is put in the strip', async () => {
    const tab = await openSite()

    workspace.tabs = [...workspace.tabs, new Tab(tab.note, tab.paneId)]

    expect(onSite()).toEqual([tab])
    expect(workspace.tabs).toHaveLength(2)
  })

  test('two tabs of it in a session from before come back as one and a copy', async () => {
    const tab = await openSite()
    workspace.split('row', tab.id)
    const layout = workspace.layout()
    for (const pane of panesOf(layout.frame)) {
      for (const draft of pane.tabs) {
        draft.path = SITE
        draft.share = tab.note.key
      }
    }

    onePane()
    await workspace.applyLayout(layout)

    expect(onSite()).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(2)
  })

  test('a note may still be in two panes', async () => {
    await workspace.open('/space/a.md')
    workspace.split('row')

    expect(workspace.tabs.filter((one) => one.path === '/space/a.md')).toHaveLength(2)
  })
})

describe('a search of the space', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
  })

  test('finds the words of a note with no file, by its tab', async () => {
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('nothing opened')
    tab.note.live.replace('# Plan\n\nbuy milk')
    const { unsavedHits } = await import('./search/unsaved')
    const { parseQuery } = await import('@orden/scan/search/query')

    expect(unsavedHits(parseQuery('milk'), 's', 10)).toEqual([
      expect.objectContaining({ tab: tab.id, line: 2, text: 'buy milk' }),
    ])
    expect(unsavedHits(parseQuery('milk'), 'another', 10)).toEqual([])
  })
})

describe('an essential', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    for (const one of [...workspace.bookmarks.list]) workspace.bookmarks.remove(one)
  })

  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)
  const keep = (path: string) =>
    workspace.bookmarks.toggle(workspace.bookmarks.forEntry({ path, is_dir: false }))

  test('takes no place in the strip a tab is dragged to or reopened into', async () => {
    keep('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    for (const name of ['b', 'c']) await workspace.open(`/space/${name}.md`)
    expect(workspace.tabs).toHaveLength(3)
    expect(strip()).toEqual(['/space/b.md', '/space/c.md'])

    const b = workspace.tabs.find((one) => one.path === '/space/b.md')!
    workspace.moveTab(b.id, workspace.panes.focusedId, 1)
    expect(strip()).toEqual(['/space/c.md', '/space/b.md'])

    workspace.moveTab(b.id, workspace.panes.focusedId, 0)
    const c = workspace.tabs.find((one) => one.path === '/space/c.md')!
    workspace.close(c.id)
    await workspace.reopenClosed()
    expect(strip()).toEqual(['/space/b.md', '/space/c.md'])
  })

  test('shows its file with no tab in the strip', async () => {
    keep('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')

    expect(workspace.active?.path).toBe('/space/a.md')
    expect(workspace.active?.essential).toBe('/space/a.md')
    expect(strip()).toEqual([])
  })

  test('stays loaded behind another tab, and comes back as it was left', async () => {
    keep('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    const first = workspace.active?.id
    await workspace.open('/space/b.md')

    expect(strip()).toEqual(['/space/b.md'])
    expect(workspace.tabs).toHaveLength(2)

    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    expect(workspace.active?.id).toBe(first)
    expect(workspace.tabs).toHaveLength(2)
  })

  test('is a view of its own of a file the strip already has open', async () => {
    keep('/space/a.md')
    await workspace.open('/space/a.md')
    const inStrip = workspace.active
    await (await import('./essentials.svelte')).openEssential('/space/a.md')

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.active?.id).not.toBe(inStrip?.id)
    expect(workspace.active?.note).toBe(inStrip?.note)
  })

  test('goes back to the strip once it is taken out of the Essentials', async () => {
    keep('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    keep('/space/a.md')
    await workspace.bookmarks.offered
    await new Promise((done) => setTimeout(done))

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.active?.essential).toBeNull()
  })

  test('stays on screen when the last tab of the strip closes behind it', async () => {
    keep('/space/a.md')
    await workspace.open('/space/b.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    const shown = workspace.active?.id
    const behind = workspace.tabs.find((one) => one.path === '/space/b.md')
    if (!behind) throw new Error('b is not open')

    workspace.close(behind.id)

    expect(workspace.active?.id).toBe(shown)
    expect(strip()).toEqual([])
  })

  test('closed, hands the pane back to the tab shown before it', async () => {
    keep('/space/a.md')
    await workspace.open('/space/b.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')

    workspace.close(workspace.active?.id ?? '')

    expect(workspace.active?.path).toBe('/space/b.md')
  })

  test('follows its file when the file is renamed', async () => {
    keep('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    const shown = workspace.active

    await workspace.fileMoved('/space/a.md', '/space/z.md', 'file')

    expect(shown?.essential).toBe('/space/z.md')
    expect(strip()).toEqual([])
  })
})

describe('an essential of a web note with web data of its own', () => {
  const SITE = '/space/site.url'
  const OWN = '3f9a0c17e2b4d685'
  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)
  const keep = (path: string) =>
    workspace.bookmarks.toggle(workspace.bookmarks.forEntry({ path, is_dir: false }))
  const essentials = () => import('./essentials.svelte')

  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    for (const one of [...workspace.bookmarks.list]) workspace.bookmarks.remove(one)
    notes[SITE] = writeShortcut('https://example.com/', 'Site', new Date(), null, null, OWN)
    workspace.tabs = []
  })

  afterEach(() => {
    workspace.tabs = []
    delete notes['/space/site.url']
  })

  test('is on the note’s own web data when its tile opens it', async () => {
    keep(SITE)
    await (await essentials()).openEssential(SITE)

    expect(workspace.active?.essential).toBe(SITE)
    expect(apartOf(workspace.active ?? { path: null, doc: '' })).toBe(OWN)
  })

  test('is the strip’s tab of it, page and web data with it, and goes back as it was', async () => {
    await workspace.openEntry(SITE)
    const tab = workspace.active
    keep(SITE)
    await (await essentials()).openEssential(SITE)

    expect(workspace.tabs).toEqual([tab])
    expect(tab?.essential).toBe(SITE)
    expect(tab?.path).toBe(SITE)
    expect(strip()).toEqual([])

    keep(SITE)
    await workspace.bookmarks.offered
    await new Promise((done) => setTimeout(done))

    expect(strip()).toEqual([SITE])
    expect(apartOf(tab ?? { path: null, doc: '' })).toBe(OWN)
  })

  test('a second tab of it takes the web data along', async () => {
    keep(SITE)
    await (await essentials()).openEssential(SITE)
    await (await essentials()).openInStrip(SITE, { beside: true })

    const copy = workspace.tabs.find((one) => one.essential === null)
    expect(copy?.path).toBeNull()
    expect(apartOf(copy ?? { path: null, doc: '' })).toBe(OWN)
  })

  test('a link out of it opens on its web data', async () => {
    await workspace.openEntry(SITE)
    const from = workspace.active

    const opened = workspace.openPage('https://example.com/next', 'plain', from?.id)
    const tab = workspace.tabs.find((one) => one.id === opened)

    expect(apartOf(tab ?? { path: null, doc: '' })).toBe(OWN)
  })
})

describe('an essential asked for in a tab', () => {
  beforeEach(() => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
  })

  const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.path)

  test('gets one of its own beside the essential, on the one document', async () => {
    await (await import('./essentials.svelte')).openEssential('/space/a.md')
    const essential = workspace.active

    await (await import('./essentials.svelte')).openInStrip('/space/a.md', { beside: true })

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.active?.essential).toBeNull()
    expect(workspace.active?.note).toBe(essential?.note)
  })

  test('is the tab of the strip that already shows it', async () => {
    await workspace.open('/space/a.md')
    await (await import('./essentials.svelte')).openEssential('/space/a.md')

    await (await import('./essentials.svelte')).openInStrip('/space/a.md', {})

    expect(strip()).toEqual(['/space/a.md'])
    expect(workspace.tabs).toHaveLength(2)
  })
})

describe('the words of the paper a page note holds', () => {
  const papers = () => import('./pdf/papers')
  const hits = async (root: string) => {
    const { searchPapers } = await papers()
    const { parseQuery } = await import('@orden/scan/search/query')
    return searchPapers(root, parseQuery('entropy'), 20).map((hit) => hit.path)
  }
  const settled = () => new Promise((done) => setTimeout(done, 0))

  beforeEach(async () => {
    const { forgetPapers, paperRead } = await papers()
    forgetPapers()
    paperRead('/space/Lecture.pages.pdf', 1, ['entropy', 'of', 'a', 'system'])
  })

  afterEach(async () => (await papers()).forgetPapers())

  test('follow the note renamed', async () => {
    await workspace.fileMoved('/space/Lecture.pages', '/space/Physics.pages', 'file')
    await settled()

    expect(await hits('/space')).toEqual(['/space/Physics.pages.pdf'])
  })

  test('go with the note deleted', async () => {
    await workspace.fileGone('/space/Lecture.pages', 'file')
    await settled()

    expect(await hits('/space')).toEqual([])
  })

  test('follow the space renamed', async () => {
    await workspace.fileOps.tell({
      op: 'moved',
      from: '/space',
      to: '/renamed',
      kind: 'space',
      root: '/space',
      into: '/renamed',
    })
    await settled()

    expect(await hits('/renamed')).toEqual(['/renamed/Lecture.pages.pdf'])
  })
})

describe('Settings', () => {
  beforeEach(() => {
    onePane()
    workspace.restored = true
  })

  test('opens as a tab of its own, not a sheet over the app', async () => {
    const { settings } = await import('./settings.svelte')
    settings.show()

    const [tab] = workspace.tabs
    expect(workspace.tabs).toHaveLength(1)
    expect(tab?.kind).toBe('settings')
    expect(tab?.path).toBeNull()
    expect(workspace.active?.id).toBe(tab?.id)
    expect(settings.open).toBe(true)
  })

  test('is one tab however often it is asked for, and asking brings it to the front', async () => {
    const { settings } = await import('./settings.svelte')
    settings.show()
    const first = workspace.active?.id
    await workspace.open('/space/a.md')
    expect(settings.open).toBe(false)

    settings.show('shortcuts')
    settings.show()
    settings.show('account')

    expect(workspace.tabs.filter((one) => one.kind === 'settings').map((one) => one.id)).toEqual([
      first,
    ])
    expect(workspace.active?.id).toBe(first)
    expect(settings.open).toBe(true)
  })

  test('a page asked for is the one shown, and the button keeps the page it was left on', async () => {
    const { settings } = await import('./settings.svelte')
    settings.show('appearance')
    expect(settings.section).toBe('appearance')
    expect(settings.listing).toBe(false)

    await workspace.open('/space/a.md')
    settings.show()
    expect(settings.section).toBe('appearance')

    settings.open = false
    settings.show()
    expect(settings.section).toBe('general')
  })

  test('asked for before the tabs are back, it opens once they are', async () => {
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
    const { settings } = await import('./settings.svelte')
    workspace.restored = false
    settings.show('appearance')
    expect(workspace.tabs).toHaveLength(0)

    await workspace.restore()
    expect(workspace.tabs.map((one) => one.kind)).toContain('settings')
    expect(settings.section).toBe('appearance')
    vi.unstubAllGlobals()
  })

  test('on a phone it stands over the note it was opened from, and closing it brings that note back', async () => {
    const { settings } = await import('./settings.svelte')
    const was = viewport.device
    viewport.device = 'phone'
    try {
      await workspace.open('/space/a.md')
      settings.show('appearance')
      expect(workspace.active?.kind).toBe('settings')

      settings.open = false
      expect(workspace.active?.path).toBe('/space/a.md')
    } finally {
      viewport.device = was
    }
  })

  test('closing it leaves no tab, and it is no kind the new tab offers', async () => {
    const { settings } = await import('./settings.svelte')
    const { newKinds } = await import('./new-kinds')
    settings.show()
    settings.open = false
    expect(workspace.tabs.some((one) => one.kind === 'settings')).toBe(false)
    expect(newKinds().map((one) => one.mark)).not.toContain('settings')
  })
})

describe('a space and its AGENTS.md', () => {
  const entry = (path: string, children: Entry[] | null = null): Entry => ({
    name: path.split('/').at(-1) ?? '',
    path,
    is_dir: children !== null,
    children: children ?? [],
    modified: 1,
    created: 1,
  })
  const AGENTS = '/space/AGENTS.md'
  const NESTED = '/space/sub/AGENTS.md'
  const walked = (one: Entry | null): string[] =>
    (one?.children ?? []).flatMap((child) => [child.path, ...walked(child)])

  beforeEach(async () => {
    onePane()
    workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
    workspace.activeSpaceId = 'one'
    workspace.closed.stack = []
    notes[AGENTS] = '# Rules'
    notes[NESTED] = '# Nested'
    workspace.tree = entry('/space', [
      entry(AGENTS),
      entry('/space/a.md'),
      entry('/space/sub', [entry(NESTED)]),
    ])
    const { settings } = await import('./settings.svelte')
    workspace.restored = true
    settings.open = false
    sent.length = 0
  })

  afterEach(() => {
    Reflect.deleteProperty(notes, AGENTS)
    Reflect.deleteProperty(notes, NESTED)
    workspace.tree = null
  })

  test('dropped against a pane side opens its settings tab and splits nothing', async () => {
    await workspace.open('/space/a.md')
    const [only] = workspace.panes.all
    if (!only) throw new Error('nothing opened')

    await workspace.dropNotes([AGENTS], { kind: 'pane', paneId: only.id, zone: 'right' })

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabsIn(only.id).map((tab) => tab.path ?? tab.kind)).toEqual([
      '/space/a.md',
      'settings',
    ])
  })

  test('is on the disk still, and in the listing that says so', () => {
    expect(walked(workspace.tree)).toContain(AGENTS)
    expect(workspace.entryAt(AGENTS)?.path).toBe(AGENTS)
  })

  test('has no row, is no note, and is not what a list of files offers', () => {
    expect(walked(workspace.shownTree)).not.toContain(AGENTS)
    expect(workspace.files.map((one) => one.path)).not.toContain(AGENTS)
    expect(workspace.notes.map((one) => one.path)).not.toContain(AGENTS)
  })

  test('one in a folder is any other note', () => {
    expect(walked(workspace.shownTree)).toContain(NESTED)
    expect(workspace.notes.map((one) => one.path)).toContain(NESTED)
  })

  test('is left out of the picture of the space, and not of what an agent searches', () => {
    expect(workspace.leftOut).toContain('AGENTS.md')
    expect(workspace.leftOutOf('/space')).not.toContain('AGENTS.md')
  })

  test('is not among the recent notes', async () => {
    workspace.remember(AGENTS)
    workspace.remember('/space/a.md')
    await Promise.resolve()
    expect(workspace.recent).not.toContain(AGENTS)
    expect(workspace.recent).toContain('/space/a.md')
  })

  test('opened from anywhere, it is the field and no tab', async () => {
    const { settings } = await import('./settings.svelte')
    await workspace.open(AGENTS)
    expect(workspace.tabs.map((one) => one.path)).not.toContain(AGENTS)
    expect(settings.open).toBe(true)
    expect(settings.section).toBe('space')
    expect(settings.space).toBe('/space')
  })

  test('opened behind the reader, it moves nothing', async () => {
    const { settings } = await import('./settings.svelte')
    await workspace.open(AGENTS, { activate: false })
    expect(workspace.tabs.map((one) => one.path)).not.toContain(AGENTS)
    expect(settings.open).toBe(false)
  })

  test('one in a folder opens as a note', async () => {
    await workspace.open(NESTED)
    expect(workspace.active?.path).toBe(NESTED)
  })

  test('a new file never takes the name, anywhere in the space', () => {
    expect(workspace.freeName('/elsewhere', 'AGENTS.md')).toBe('AGENTS 2.md')
    expect(workspace.freeName('/space/sub', 'agents.md')).toBe('agents 2.md')
    expect(workspace.freeName('/elsewhere', 'AGENTS.canvas')).toBe('AGENTS.canvas')
  })

  test('words headed AGENTS step aside rather than becoming the setting', async () => {
    Reflect.deleteProperty(notes, AGENTS)
    const made = await workspace.noteFrom('# AGENTS\n', '/space')
    expect(made).toBe('/space/AGENTS 2.md')
    Reflect.deleteProperty(notes, '/space/AGENTS 2.md')
  })

  test('a link to a note of the name makes none, and a hint says where it is', async () => {
    const { reservedName } = await import('./reserved-name.svelte')
    Reflect.deleteProperty(notes, AGENTS)
    await workspace.followLink(
      { target: 'AGENTS', path: null, heading: null, block: null, page: null },
      'plain',
      '/space/a.md',
    )
    await vi.waitFor(() => expect(reservedName.root).toBe('/space'))
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    reservedName.dismiss()
  })

  test('a note of the name dropped on the top of the space stays where it was', async () => {
    const { reservedName } = await import('./reserved-name.svelte')
    await workspace.moveMany([NESTED], '/space')
    await vi.waitFor(() => expect(reservedName.root).toBe('/space'))
    expect(sent.filter((one) => one.command === 'rename_note')).toEqual([])
    reservedName.dismiss()
  })

  test('between two folders it is the note it was', async () => {
    workspace.tree = entry('/space', [
      entry('/space/sub', [entry(NESTED)]),
      entry('/space/other', []),
    ])
    await workspace.moveMany([NESTED], '/space/other')
    expect(sent.filter((one) => one.command === 'rename_note')).toHaveLength(1)
  })

  test('an agent’s move being undone puts one back on the top of the space', async () => {
    await workspace.moveMany([NESTED], '/space', true)
    expect(sent.filter((one) => one.command === 'rename_note')).toHaveLength(1)
  })

  describe('on a disk that sets case aside', () => {
    const LOWER = '/space/agents.md'

    beforeEach(() => {
      answeredCase('/space', true)
      notes[LOWER] = '# Lower'
      workspace.tree = entry('/space', [entry(LOWER), entry('/space/a.md')])
    })

    afterEach(() => {
      answeredCase('/space', null)
      Reflect.deleteProperty(notes, LOWER)
    })

    test('a root agents.md is the one file, so it has no row and is the field', async () => {
      const { settings } = await import('./settings.svelte')
      expect(workspace.instructionsAt(LOWER)).toBe(true)
      expect(walked(workspace.shownTree)).not.toContain(LOWER)
      expect(workspace.files.map((one) => one.path)).not.toContain(LOWER)

      await workspace.open(LOWER)
      expect(workspace.tabs.map((one) => one.path)).not.toContain(LOWER)
      expect(settings.section).toBe('space')
    })

    test('what a search leaves out is spelled as the listing spells it', () => {
      expect(workspace.leftOut).toContain('agents.md')
    })
  })

  describe('on a disk that tells case apart', () => {
    const LOWER = '/space/agents.md'

    beforeEach(() => {
      answeredCase('/space', false)
      notes[LOWER] = '# Lower'
      workspace.tree = entry('/space', [entry(AGENTS), entry(LOWER)])
    })

    afterEach(() => {
      answeredCase('/space', null)
      Reflect.deleteProperty(notes, LOWER)
    })

    test('a root agents.md is a note of its own beside the setting', async () => {
      expect(workspace.instructionsAt(LOWER)).toBe(false)
      expect(walked(workspace.shownTree)).toContain(LOWER)
      expect(walked(workspace.shownTree)).not.toContain(AGENTS)
      await workspace.open(LOWER)
      expect(workspace.active?.path).toBe(LOWER)
    })
  })
})

describe('the tab a pane comes back to', () => {
  beforeEach(() => {
    onePane()
  })

  async function strip(before: 'b' | 'c' = 'c') {
    for (const name of ['a', 'b', 'c']) await workspace.open(`/space/${name}.md`)
    const id = (name: string) => workspace.tabs.find((tab) => tab.name === `${name}.md`)?.id ?? ''
    workspace.activate(id(before === 'b' ? 'c' : 'b'))
    workspace.activate(id(before))
    workspace.activate(id('a'))
    const [only] = workspace.panes.all
    if (!only || workspace.tabs.length !== 3) throw new Error('the strip did not open')
    return { id, pane: only.id }
  }

  const shown = (pane: string) =>
    workspace.tabs.find((tab) => tab.id === workspace.panes.at(pane)?.activeTabId)?.name

  test('a tab dragged out to split leaves the one used before it, not the first', async () => {
    const { id, pane } = await strip('b')
    workspace.dropTab(id('a'), { kind: 'pane', paneId: pane, zone: 'right' })
    expect(workspace.panes.count).toBe(2)
    expect(shown(pane)).toBe('b.md')
  })

  test('and dragged into another pane the same, where it is the one used last', async () => {
    const { id, pane } = await strip('b')
    workspace.split('row')
    const other = workspace.panes.focusedId
    workspace.activate(id('a'))
    workspace.dropTab(id('a'), { kind: 'strip', paneId: other, at: 0 })
    expect(shown(pane)).toBe('b.md')
    expect(shown(other)).toBe('a.md')
  })

  test('closing the tab in front shows the one used before it, not its neighbour', async () => {
    const { id, pane } = await strip()
    workspace.close(id('a'))
    expect(shown(pane)).toBe('c.md')
  })

  test('with none of them ever in front, the neighbour of the one that went, right then left', async () => {
    const { id, pane } = await strip()
    workspace.panes.used = []
    workspace.close(id('a'))
    expect(shown(pane)).toBe('b.md')
    workspace.activate(id('c'))
    workspace.panes.used = []
    workspace.close(id('c'))
    expect(shown(pane)).toBe('b.md')
  })

  test('a launch keeps each pane’s order of use', async () => {
    await strip()
    const written = workspace.layout()
    const recent = written.frame.kind === 'pane' ? written.frame.pane.recent : undefined
    const names = workspace.tabs.map((tab) => tab.name)
    expect(recent?.slice(0, 2).map((at) => names[at])).toEqual(['a.md', 'c.md'])
  })
})

describe('a closed tab brought back while its pane goes', () => {
  beforeEach(() => {
    onePane()
  })

  afterEach(() => {
    holding.read = null
    holding.readPath = ''
    workspace.collapsePanes()
  })

  test('comes back in a pane that is there, not the one that went meanwhile', async () => {
    await workspace.open('/space/a.md')
    await beside('/space/b.md')
    await workspace.open('/space/c.md')
    const going = workspace.active
    if (going?.path !== '/space/c.md') throw new Error('c did not open beside')
    workspace.close(going.id)

    let release: () => void = () => undefined
    holding.readPath = '/space/c.md'
    holding.read = new Promise<void>((resolve) => {
      release = resolve
    })
    const asked = given.length
    const back = workspace.reopenClosed()
    await vi.waitFor(() => {
      expect(
        given
          .slice(asked)
          .some((one) => one.command === 'read_note' && pathOf(one.args) === '/space/c.md'),
      ).toBe(true)
    })

    await workspace.closePane()
    release()
    await back

    const again = workspace.tabs.find((one) => one.path === '/space/c.md')
    expect(again && workspace.panes.at(again.paneId)).toBeTruthy()
    expect(workspace.tabs.every((one) => workspace.panes.at(one.paneId))).toBe(true)
    expect(workspace.activeTabId).toBe(again?.id)
  })
})

describe('a tab that held a web page and now shows a note', () => {
  beforeEach(() => {
    onePane()
  })

  test('lets the page go when it closes', async () => {
    await workspace.open('/space/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    pages.of(tab.id)

    workspace.close(tab.id)

    expect(pages.each().map(([id]) => id)).not.toContain(tab.id)
  })
})
