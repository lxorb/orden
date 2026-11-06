import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string) => Promise.resolve(command === 'read_note' ? '# a' : undefined),
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
const { keepAsTab, openEssential } = await import('./essentials.svelte')
const { essentialLetters } = await import('./tab-strip/letters.svelte')
const { droppedEssential } = await import('./tab-strip/essential-drop')
const { flushSync } = await import('svelte')
type Entry = import('./workspace.svelte').Entry

const file = (path: string): Entry => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})

const note = (path: string) => ({ kind: 'note' as const, path, text: '' })
const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((one) => one.path)

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tree = {
    ...file('/space'),
    is_dir: true,
    children: [file('/space/Notes.md'), file('/space/Next.md')],
  }
  workspace.bookmarks.put('/space', [note('Notes.md')])
})

describe('an essential double clicked', () => {
  test('is a tab of the strip, in front, and the tile then opens a view of its own', async () => {
    await openEssential('/space/Notes.md')
    expect(strip()).not.toContain('/space/Notes.md')
    const shown = workspace.active

    await keepAsTab('/space/Notes.md')
    expect(strip()).toContain('/space/Notes.md')
    expect(workspace.active).toBe(shown)
    expect(shown?.essential).toBeNull()

    await openEssential('/space/Notes.md')
    expect(workspace.active).not.toBe(shown)
    expect(workspace.active?.essential).toBe('/space/Notes.md')
  })
})

describe('an essential pressed while the window is split', () => {
  test('is kept as a tab of the strip in front, and no pane loses what it showed', async () => {
    workspace.panes.collapse()
    workspace.tabs = []
    workspace.openBlank('Left', '# Left')
    const left = workspace.panes.focusedId
    const right = workspace.panes.split('row', left)
    expect(right).not.toBeNull()
    workspace.openBlank('Right', '# Right')
    const showing = workspace.tabs.map((one) => one.id)

    await openEssential('/space/Notes.md')
    expect(strip()).toContain('/space/Notes.md')
    expect(workspace.active?.essential).toBeNull()
    expect(workspace.active?.path).toBe('/space/Notes.md')
    for (const id of showing) expect(workspace.tabs.some((one) => one.id === id)).toBe(true)
    workspace.panes.collapse()
  })

  test('opens a view of its own as before with the window not split', async () => {
    workspace.panes.collapse()
    workspace.tabs = []
    workspace.openBlank('Only', '# Only')
    await openEssential('/space/Notes.md')
    expect(workspace.active?.essential).toBe('/space/Notes.md')
    expect(strip()).not.toContain('/space/Notes.md')
  })
})

describe('an essential dragged into a strip', () => {
  test('is kept as a tab where it was let go, as it was, as a double click keeps it', async () => {
    workspace.panes.collapse()
    workspace.tabs = []
    workspace.openBlank('First', '# First')
    workspace.openBlank('Second', '# Second')
    await openEssential('/space/Notes.md')
    const shown = workspace.active
    shown!.scroll = 240

    const pane = workspace.panes.focusedId
    const id = await droppedEssential(0, pane, 1)
    expect(id).toBe(shown?.id)
    expect(shown?.essential).toBeNull()
    expect(strip()).toEqual([null, '/space/Notes.md', null])
    expect(workspace.active).toBe(shown)
    expect(shown?.scroll).toBe(240)
  })

  test('is what the strip does with a bookmark let go of on it', () => {
    const tabs = readFileSync(new URL('./Tabs.svelte', import.meta.url), 'utf8')
    expect(tabs).toMatch(/const takes = [^\n]*\n?[^\n]*isBookmarkDrag\(transfer\)/)
    expect(tabs).toContain('droppedEssential(mark, paneId, at)')
  })

  test('and a bookmark that is no note is no tab', async () => {
    workspace.bookmarks.put('/space', [{ kind: 'group', path: 'g', text: 'Group' }])
    const before = workspace.tabs.length
    expect(await droppedEssential(0, workspace.panes.focusedId, 0)).toBeNull()
    expect(workspace.tabs.length).toBe(before)
  })
})

describe('the letters of the Essentials', () => {
  test('are given by name and kept as another is added in front', () => {
    flushSync()
    expect(essentialLetters.given).toEqual({ '/space/Notes.md': 'N' })
    expect(essentialLetters.pathOf('N')).toBe('/space/Notes.md')

    workspace.bookmarks.put('/space', [note('Next.md'), note('Notes.md')])
    flushSync()
    expect(essentialLetters.given).toEqual({ '/space/Notes.md': 'N', '/space/Next.md': 'E' })
  })
})
