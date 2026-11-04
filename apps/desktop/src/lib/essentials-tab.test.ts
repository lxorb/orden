import { beforeEach, describe, expect, test, vi } from 'vitest'

/** An essential kept as a tab of the strip by a double click of its tile, and the
 *  letters the Essentials wear while Alt is held (#1051). The store is the real one; the
 *  disk is a stand-in. */

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
