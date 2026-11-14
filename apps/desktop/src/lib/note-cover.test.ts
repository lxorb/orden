import { describe, expect, test, vi } from 'vitest'

const SPACE: Record<string, string> = {
  '/space/plain.md': '# Plain\n\nwords\n',
  '/space/titled.md': '---\ntitle: Titled\n---\n\n# Titled\n',
  '/space/covered.md': '---\ncover: assets/old.jpg\ncover-position: 20\n---\n\n# Covered\n',
  '/space/only.md': '---\ncover: assets/only.jpg\n---\n\n# Only a cover\n',
}

let notes: Record<string, string> = { ...SPACE }

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

const sent: { command: string; path: string; content: string }[] = []

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = pathOf(args)
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })

    if (command === 'write_note') {
      notes[path] = content
      return undefined
    }
    if (command !== 'read_note') return undefined

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

const { canHaveCover, removeCover, setCover } = await import('./note-cover')
const { workspace } = await import('./workspace.svelte')

function written(path: string): string | null {
  const write = sent.filter((one) => one.command === 'write_note' && one.path === path).pop()
  return write?.content ?? null
}

function fresh() {
  notes = { ...SPACE }
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.itemMeta.forget('/space')
  workspace.tabs = []
  workspace.activeTabId = null
  workspace.undone.stack = []
  sent.length = 0
}

const kept = (path: string) => workspace.itemMeta.of(path, '/space')

describe('the cover a note is given (#1210)', () => {
  test("is the note's own metadata, and the note's words are not touched", async () => {
    fresh()
    await setCover('/space/plain.md', 'assets/wide.jpg')

    expect(kept('/space/plain.md')).toEqual({ cover: 'assets/wide.jpg' })
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  test('a picture whose name YAML would read as more than a name is kept as it is', async () => {
    fresh()
    await setCover('/space/plain.md', 'assets/Meeting: notes.jpg')

    expect(kept('/space/plain.md')).toEqual({ cover: 'assets/Meeting: notes.jpg' })
  })

  test('replaces the picture that was there, puts its band back in the middle, and takes the keys its front matter still said out of it', async () => {
    fresh()
    workspace.itemMeta.set('/space/plain.md', { cover: 'assets/old.jpg', 'cover-position': '20' })
    await setCover('/space/plain.md', 'assets/new.jpg')
    expect(kept('/space/plain.md')).toEqual({ cover: 'assets/new.jpg' })

    await setCover('/space/covered.md', 'assets/new.jpg')
    expect(written('/space/covered.md')).toBe('# Covered\n')
  })

  test('leaves the rest of the front matter as it was', async () => {
    fresh()
    notes['/space/titled.md'] = '---\ntitle: Titled\ncover: a.jpg\n---\n\n# Titled\n'
    await setCover('/space/titled.md', 'assets/wide.jpg')

    expect(written('/space/titled.md')).toBe('---\ntitle: Titled\n---\n\n# Titled\n')
  })
})

describe('taking a note’s cover away', () => {
  test('takes it and its place out of the metadata', async () => {
    fresh()
    await setCover('/space/plain.md', 'assets/wide.jpg')
    await removeCover('/space/plain.md')

    expect(kept('/space/plain.md')).toBeNull()
  })

  test('and out of the front matter where the note still said it, the block with it', async () => {
    fresh()
    await removeCover('/space/only.md')

    expect(written('/space/only.md')).toBe('# Only a cover\n')
  })

  test('a note that never had one is not written to', async () => {
    fresh()
    await removeCover('/space/plain.md')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

describe('a note that is open while its cover changes', () => {
  test('keeps its words as they were, and stays saved', async () => {
    fresh()
    await workspace.open('/space/plain.md')
    await setCover('/space/plain.md', 'assets/wide.jpg')

    const tab = workspace.tabs.find((one) => one.path === '/space/plain.md')
    expect(tab?.doc).toBe('# Plain\n\nwords\n')
    expect(tab?.dirty).toBe(false)
  })
})

describe('what can have one', () => {
  test('is a note, and not a plane, a set of pages or a folder', () => {
    expect(canHaveCover('/space/note.md')).toBe(true)
    expect(canHaveCover('/space/Board.canvas')).toBe(false)
    expect(canHaveCover('/space/Deck.pages')).toBe(false)
    expect(canHaveCover('/space/folder')).toBe(false)
    expect(canHaveCover(null)).toBe(false)
  })
})
