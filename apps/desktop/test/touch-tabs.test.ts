import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from './disk'

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

  const typed = (words: string) =>
    workspace.active?.note.live.edit([{ from: 0, to: 0, insert: words }])

  test.each([
    [
      'put away by the plus',
      () => {
        workspace.openBlank()
        return Promise.resolve()
      },
    ],
    ['left by opening another note', () => workspace.open('/space/One.md')],
    [
      'left by turning to another tab',
      async () => {
        const { turnTab } = await tabSwipe()
        turnTab(90, 0)
      },
    ],
  ])('a draft with words %s is written down and stays a tab', async (_, leave) => {
    viewport.device = 'phone'
    await workspace.open('/space/One.md')

    workspace.openBlank()
    typed('Shopping list\nmilk and eggs')
    await leave()

    await vi.waitFor(() =>
      expect(notes.get('/space/Shopping list.md')).toBe('Shopping list\nmilk and eggs'),
    )
    expect(workspace.tabs.map((tab) => tab.path)).toContain('/space/Shopping list.md')
    expect(workspace.closed.any).toBe(false)
  })

  test('the draft that is shown is not written, nor one left on a desktop', async () => {
    const before = notes.size
    workspace.openBlank()
    typed('Desk words')
    workspace.openBlank()

    viewport.device = 'phone'
    workspace.activate(workspace.tabs[0]?.id ?? '')
    typed('Phone ')
    await new Promise((done) => setTimeout(done, 50))

    expect(notes.size).toBe(before)
    expect(workspace.tabs.map((tab) => tab.path)).toEqual([null, null])
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
