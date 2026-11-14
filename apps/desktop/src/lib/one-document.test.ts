import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const notes = new Map<string, string>()
let binFull = false

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./pdf/document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdf/document')>()),
  pageSizes: () => Promise.resolve([{ width: 794, height: 1123 }]),
}))

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      case 'trash_words':
        if (binFull) throw new Error('the bin is full')
        return { id: 't' }
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        if (args?.root !== '/space') throw new Error('root is not a directory')
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
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
const { viewport } = await import('./viewport.svelte')

const open = () => workspace.tabs.map((tab) => tab.shown)

beforeEach(() => {
  binFull = false
  notes.clear()
  notes.set('/space/One.md', '# One')
  notes.set('/space/Two.md', '# Two')
  notes.set('/space/Three.md', '# Three')
  notes.set('/space/Plan.canvas', '{"nodes":[]}')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.panes.collapse()
  viewport.device = 'desktop'
})

afterEach(() => {
  workspace.tabs = []
  viewport.device = 'desktop'
})

describe('a desktop', () => {
  test('keeps every note that is opened, and can still split a pane', async () => {
    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    expect(open()).toEqual(['One', 'Two'])
    expect(workspace.canSplit('row')).toBe(true)

    workspace.split('row')
    expect(workspace.panes.count).toBe(2)
    expect(workspace.tabs).toHaveLength(3)

    workspace.collapsePanes()
  })
})

describe('a phone and a tablet', () => {
  test.each(['phone', 'tablet'] as const)('hold one note at a time (%s)', async (device) => {
    viewport.device = device

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    await workspace.open('/space/Three.md')

    expect(open()).toEqual(['Three'])
    expect(workspace.active?.shown).toBe('Three')
  })

  test('a canvas and a paper take the place of the note as well', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.openCanvas('/space/Plan.canvas')
    expect(open()).toEqual(['Plan'])

    await workspace.openPdf('/space/Paper.pdf')
    expect(open()).toEqual(['Paper'])
    expect(workspace.active?.kind).toBe('pages')
  })

  test('the note that went is on the closed stack, and comes back whole', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    expect(workspace.closed.any).toBe(true)
    expect(workspace.closed.stack.at(-1)?.draft).toMatchObject({ path: '/space/One.md' })

    await workspace.reopenClosed()
    expect(workspace.active?.doc).toBe('# One')
  })

  test('so back is the note before, and back again the one before that', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')

    await workspace.reopenClosed()
    expect(open()).toEqual(['One'])

    await workspace.reopenClosed()
    expect(open()).toEqual(['Two'])
  })

  test('a draft with words is written down as it goes, not left in the bin', async () => {
    viewport.device = 'phone'

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Shopping list\nmilk and eggs' }])
    await workspace.open('/space/One.md')
    expect(open()).toEqual(['One'])

    await vi.waitFor(() => {
      expect(notes.get('/space/Shopping list.md')).toBe('Shopping list\nmilk and eggs')
      expect(workspace.closed.stack.at(-1)?.draft).toMatchObject({
        path: '/space/Shopping list.md',
      })
    })

    await workspace.reopenClosed()
    expect(workspace.active?.doc).toBe('Shopping list\nmilk and eggs')
  })

  test('one that cannot be written down or binned is still put away, and nothing is left unhandled', async () => {
    viewport.device = 'phone'
    binFull = true
    const unheard: unknown[] = []
    const hear = (error: unknown) => unheard.push(error)
    process.on('unhandledRejection', hear)
    const save = vi.spyOn(workspace, 'save').mockResolvedValue(null)
    try {
      workspace.openBlank()
      workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Shopping list' }])
      workspace.openBlank()

      await vi.waitFor(() => expect(workspace.closed.stack).toHaveLength(1))
      await new Promise((done) => setTimeout(done, 50))
      expect(unheard).toEqual([])
    } finally {
      save.mockRestore()
      process.off('unhandledRejection', hear)
    }
  })

  test('so does one the plus put away', async () => {
    viewport.device = 'phone'

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Shopping list' }])
    workspace.openBlank()

    expect(workspace.tabs).toHaveLength(1)
    await vi.waitFor(() => expect(notes.get('/space/Shopping list.md')).toBe('Shopping list'))
  })

  test('an empty one just goes', async () => {
    viewport.device = 'phone'
    const before = notes.size

    workspace.openBlank()
    await workspace.open('/space/One.md')

    expect(open()).toEqual(['One'])
    expect(notes.size).toBe(before)
  })

  test('two drafts with one name, put away at once, are two notes', async () => {
    viewport.device = 'phone'
    workspace.tree = null

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Same\nfirst' }])
    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Same\nsecond' }])
    workspace.openBlank()

    await vi.waitFor(() => expect(notes.get('/space/Same 2.md')).toBeDefined())
    expect([notes.get('/space/Same.md'), notes.get('/space/Same 2.md')].sort()).toEqual([
      'Same\nfirst',
      'Same\nsecond',
    ])
  })

  test('so does an untitled pair', async () => {
    viewport.device = 'phone'
    workspace.tree = null

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: '\n\nfirst' }])
    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: '\n\nsecond' }])
    workspace.openBlank()

    await vi.waitFor(() => {
      const held = [...notes.values()].filter((one) => one === '\n\nfirst' || one === '\n\nsecond')
      expect(held).toHaveLength(2)
    })
  })

  test.each(['- ', '# ', '​', '1. ', '- [ ] '])(
    'a draft of nothing but %j writes no file',
    async (words) => {
      viewport.device = 'phone'
      const before = notes.size

      workspace.openBlank()
      workspace.active?.note.live.edit([{ from: 0, to: 0, insert: words }])
      await workspace.open('/space/One.md')
      await new Promise((done) => setTimeout(done))

      expect(notes.size).toBe(before)
    },
  )

  test('the session keeps a draft until its file has landed', async () => {
    viewport.device = 'phone'

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Kept\nwords' }])
    await workspace.open('/space/One.md')

    const held = () => JSON.stringify(workspace.layout())
    expect(held()).toContain('Kept\\nwords')
    await vi.waitFor(() => expect(notes.get('/space/Kept.md')).toBe('Kept\nwords'))
    await vi.waitFor(() => expect(held()).not.toContain('Kept\\nwords'))
  })

  test('never split a pane, however it is asked', async () => {
    viewport.device = 'tablet'
    await workspace.open('/space/One.md')

    expect(workspace.canSplit('row')).toBe(false)
    expect(workspace.canSplit('column')).toBe(false)
    expect(workspace.canLand('left', workspace.panes.focusedId, null)).toBe(false)

    workspace.split('row')
    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(1)
  })

  test('a session made on a desktop arrives as the note that had the focus', async () => {
    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    workspace.split('row')
    await workspace.open('/space/Three.md')

    const kept = workspace.active?.shown
    viewport.device = 'tablet'
    workspace.oneDocument()

    expect(workspace.panes.count).toBe(1)
    expect(open()).toEqual([kept])
    expect(workspace.closed.stack.length).toBeGreaterThanOrEqual(2)
  })
})
