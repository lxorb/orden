import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../src/lib/pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/pdf/src/api')>()),
  pageSizes: () => Promise.resolve([{ width: 794, height: 1123 }]),
}))

vi.mock('../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform/src/tauri')>()),
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

const { workspace } = await import('../src/lib/workspace/src/api')
await import('../src/lib/workspace-ports')
const { viewport } = await import('../src/lib/ui-kit/src/viewport.svelte')
const { tabSwipe } = await import('../src/lib/phone/src/api')

const open = () => workspace.tabs.map((tab) => tab.shown)

beforeEach(() => {
  notes.clear()
  notes.set('/space/One.md', '# One')
  notes.set('/space/Two.md', '# Two')
  notes.set('/space/Three.md', '# Three')
  notes.set('/space/Plan.canvas', '{"nodes":[]}')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.previewTabId = null
  workspace.closed.stack = []
  workspace.panes.collapse()
  viewport.device = 'desktop'
})

afterEach(() => {
  workspace.tabs = []
  viewport.device = 'desktop'
})

describe('a desktop', () => {
  test('replaces a preview with the next one', async () => {
    await workspace.open('/space/One.md', { preview: true })
    await workspace.open('/space/Two.md', { preview: true })

    expect(open()).toEqual(['Two'])
  })

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
  test.each(['phone', 'tablet'] as const)(
    'keep every note that is opened, as tabs (%s)',
    async (device) => {
      viewport.device = device

      await workspace.open('/space/One.md')
      await workspace.open('/space/Two.md')
      await workspace.open('/space/Three.md')

      expect(open()).toEqual(['One', 'Two', 'Three'])
      expect(workspace.active?.shown).toBe('Three')
      expect(workspace.closed.any).toBe(false)
    },
  )

  test('a note tapped in the list is a tab of its own, not a preview the next one replaces', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md', { preview: true })
    await workspace.open('/space/Two.md', { preview: true })

    expect(open()).toEqual(['One', 'Two'])
    expect(workspace.previewTabId).toBeNull()
  })

  test('a canvas and a paper open beside the note', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.openCanvas('/space/Plan.canvas')
    await workspace.openPdf('/space/Paper.pdf')

    expect(open()).toEqual(['One', 'Plan', 'Paper'])
    expect(workspace.active?.kind).toBe('pages')
  })

  test('opening a note that is already a tab goes back to that tab', async () => {
    viewport.device = 'phone'

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    await workspace.open('/space/One.md')

    expect(open()).toEqual(['One', 'Two'])
    expect(workspace.active?.shown).toBe('One')
  })

  test('a draft with words stays a tab, and nothing is written for it', async () => {
    viewport.device = 'phone'
    const before = notes.size

    workspace.openBlank()
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: 'Shopping list\nmilk and eggs' }])
    await workspace.open('/space/One.md')
    await new Promise((done) => setTimeout(done, 50))

    expect(workspace.tabs.map((tab) => tab.doc)).toEqual(['Shopping list\nmilk and eggs', '# One'])
    expect(notes.size).toBe(before)
    expect(workspace.closed.any).toBe(false)
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

  test('a session made on a desktop arrives as one pane that holds every tab', async () => {
    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    workspace.split('row')
    await workspace.open('/space/Three.md')

    const kept = workspace.active?.shown
    const every = workspace.tabs.length
    viewport.device = 'tablet'
    workspace.onePane()

    expect(workspace.panes.count).toBe(1)
    expect(workspace.tabs).toHaveLength(every)
    expect(workspace.active?.shown).toBe(kept)
    expect(workspace.closed.any).toBe(false)
  })

  test('a swipe across the bar walks the tabs, and stops at either end', async () => {
    viewport.device = 'phone'
    const { turnTab } = await tabSwipe()

    await workspace.open('/space/One.md')
    await workspace.open('/space/Two.md')
    await workspace.open('/space/Three.md')

    expect(turnTab(90, 0)).toBe(true)
    expect(workspace.active?.shown).toBe('Two')
    turnTab(90, 0)
    expect(turnTab(90, 0)).toBe(false)
    expect(workspace.active?.shown).toBe('One')
    expect(turnTab(-90, 0)).toBe(true)
    expect(workspace.active?.shown).toBe('Two')
    expect(open()).toEqual(['One', 'Two', 'Three'])
  })
})
