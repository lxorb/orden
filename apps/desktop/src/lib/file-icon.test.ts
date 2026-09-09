import { describe, expect, test, vi } from 'vitest'
import { readCanvas } from '@nib/markdown/canvas'

/** Choosing an icon writes the file's own words, which means it goes through
 *  everything a write goes through: the version before it is kept, a note open in
 *  a pane takes the words in its editor rather than off the disk, and the lot is
 *  one thing to undo. So this stands a disk and a browser store in for the ones
 *  under node, and imports the workspace after them - the same way workspace.test
 *  does, and for the same reason.
 *
 *  A canvas takes the same path, with one difference: its icon sits in JSON under
 *  the `nib` key rather than in front matter. That difference is file-icon.ts's to
 *  answer, and nothing else in the app has to know about it. */

/** The two canvases, written the way `writeCanvas` writes one: tabs and a closing
 *  newline, so a file that has not changed is written back byte for byte. */
const BOARD = `${JSON.stringify({ nodes: [], edges: [] }, null, '\t')}\n`
const MARKED_BOARD = `${JSON.stringify(
  { nodes: [], edges: [], nib: { version: 1, icon: 'rocket' } },
  null,
  '\t',
)}\n`

/** The space as it stands at the start of every test: a note with no metadata at
 *  all, one with a key of its own, two already wearing an icon, and two canvases -
 *  one bare, one already marked. */
const SPACE: Record<string, string> = {
  '/space/plain.md': '# Plain\n\nwords\n',
  '/space/titled.md': '---\ntitle: Titled\n---\n\n# Titled\n',
  '/space/marked.md': '---\nicon: rocket\n---\n\n# Marked\n',
  '/space/only.md': '---\nicon: rocket\n---\n\n# Only an icon\n',
  '/space/Board.canvas': BOARD,
  '/space/Marked.canvas': MARKED_BOARD,
}

/** The disk, which every test writes to and every test starts over with. */
let notes: Record<string, string> = { ...SPACE }

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

/** Every command that was sent, so a test can say what was written and what was
 *  kept before it. */
const sent: { command: string; path: string; content: string }[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
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

const { setFileIcon } = await import('./file-icon')
const { workspace } = await import('./workspace.svelte')

/** What was written to a note, or null where nothing was. */
function written(path: string): string | null {
  const write = sent.filter((one) => one.command === 'write_note' && one.path === path).pop()
  return write?.content ?? null
}

function fresh() {
  notes = { ...SPACE }
  workspace.tabs = []
  workspace.activeTabId = null
  workspace.undone.stack = []
  sent.length = 0
}

describe('the icon a note is given', () => {
  test('opens a front matter block on a note that had none', async () => {
    fresh()
    await setFileIcon('/space/plain.md', 'Rocket')

    expect(written('/space/plain.md')).toBe('---\nicon: rocket\n---\n# Plain\n\nwords\n')
  })

  test('joins the keys a note already had, in Lucide s own spelling', async () => {
    fresh()
    await setFileIcon('/space/titled.md', 'FileText')

    expect(written('/space/titled.md')).toBe(
      '---\ntitle: Titled\nicon: file-text\n---\n\n# Titled\n',
    )
  })

  test('replaces the one that was there', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'Anchor')

    expect(written('/space/marked.md')).toBe('---\nicon: anchor\n---\n\n# Marked\n')
  })

  test('keeps the words that were there before it', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'Compass')

    const touched = sent.filter((one) => one.path === '/space/marked.md')
    expect(touched.map((one) => one.command)).toEqual(['read_note', 'snapshot_note', 'write_note'])
    expect(touched[1]?.content).toContain('icon: rocket')
  })

  test('and is one thing to undo', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'Feather')

    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('choosing the icon a note already wears writes nothing at all', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'Feather')
    sent.length = 0

    await setFileIcon('/space/marked.md', 'Feather')
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

describe('taking a note s icon away', () => {
  test('takes the key with it', async () => {
    fresh()
    await setFileIcon('/space/titled.md', 'Rocket')
    await setFileIcon('/space/titled.md', null)

    expect(written('/space/titled.md')).toBe('---\ntitle: Titled\n---\n\n# Titled\n')
  })

  test('and the whole block where the icon was all it held', async () => {
    fresh()
    await setFileIcon('/space/only.md', null)

    expect(written('/space/only.md')).toBe('# Only an icon\n')
  })

  test('a note that never wore one is not written to', async () => {
    fresh()
    await setFileIcon('/space/plain.md', null)

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

/** The half of it that a file on disk cannot show: a note somebody is reading
 *  while the icon changes. The words have to arrive in the editor, and the note
 *  has to stay saved - the front matter block on screen is the note's, not a
 *  version of it the disk has and the pane does not. */
describe('a note that is open while its icon changes', () => {
  test('takes the change in its own document, and stays saved', async () => {
    fresh()
    await workspace.open('/space/plain.md')
    await setFileIcon('/space/plain.md', 'Rocket')

    const tab = workspace.tabs.find((one) => one.path === '/space/plain.md')
    expect(tab?.doc).toBe('---\nicon: rocket\n---\n# Plain\n\nwords\n')
    expect(tab?.dirty).toBe(false)
  })

  test('and undoing puts the note back the way its reader had it', async () => {
    fresh()
    await workspace.open('/space/titled.md')
    await setFileIcon('/space/titled.md', 'Rocket')
    await workspace.undoFileAction()

    expect(workspace.tabs.find((one) => one.path === '/space/titled.md')?.doc).toBe(
      '---\ntitle: Titled\n---\n\n# Titled\n',
    )
  })
})

/** A canvas is JSON and has no front matter, so its icon goes under the `nib` key
 *  the ink already lives under - and everything else stays the same, which is the
 *  point: one function, one write, one undo step, whichever file it is. */
describe('the icon a canvas is given', () => {
  const board = (path: string) => readCanvas(written(path) ?? '')

  test('goes under the key that carries the ink, in Lucide s own spelling', async () => {
    fresh()
    await setFileIcon('/space/Board.canvas', 'FileText')

    expect(board('/space/Board.canvas').icon).toBe('file-text')
  })

  test('and the cards, the edges and the spec half are left as they were', async () => {
    fresh()
    await setFileIcon('/space/Board.canvas', 'Rocket')

    const parsed = JSON.parse(written('/space/Board.canvas') ?? '') as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'nib'])
    expect(parsed.nodes).toEqual([])
  })

  test('replaces the one that was there', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'Anchor')

    expect(board('/space/Marked.canvas').icon).toBe('anchor')
  })

  test('keeps the version that was there before it, and is one thing to undo', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'Compass')

    const touched = sent.filter((one) => one.path === '/space/Marked.canvas')
    expect(touched.map((one) => one.command)).toEqual(['read_note', 'snapshot_note', 'write_note'])
    expect(touched[1]?.content).toContain('"icon": "rocket"')
    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('and taking it away leaves the file exactly as it was before', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', null)

    expect(written('/space/Marked.canvas')).toBe(BOARD)
  })

  test('choosing the one it already wears writes nothing at all', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'Rocket')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  /** A canvas open on screen is a plane drawn out of the file's words, so the words
   *  have to change under it rather than the file being rewritten behind it. */
  test('reaches a canvas that is open, without leaving it unsaved', async () => {
    fresh()
    await workspace.open('/space/Board.canvas')
    await setFileIcon('/space/Board.canvas', 'Rocket')

    const tab = workspace.tabs.find((one) => one.path === '/space/Board.canvas')
    expect(readCanvas(tab?.doc ?? '').icon).toBe('rocket')
    expect(tab?.dirty).toBe(false)
  })
})
