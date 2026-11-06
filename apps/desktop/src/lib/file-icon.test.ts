import { describe, expect, test, vi } from 'vitest'
import { readCanvas } from '@orden/markdown/canvas'

const BOARD = `${JSON.stringify({ nodes: [], edges: [] }, null, '\t')}\n`
const MARKED_BOARD = `${JSON.stringify(
  { nodes: [], edges: [], nib: { version: 1, icon: 'rocket' } },
  null,
  '\t',
)}\n`

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'

const SPACE: Record<string, string> = {
  '/space/plain.md': '# Plain\n\nwords\n',
  '/space/titled.md': '---\ntitle: Titled\n---\n\n# Titled\n',
  '/space/marked.md': '---\nicon: rocket\n---\n\n# Marked\n',
  '/space/only.md': '---\nicon: rocket\n---\n\n# Only an icon\n',
  '/space/Board.canvas': BOARD,
  '/space/Marked.canvas': MARKED_BOARD,
  '/space/Docs.url':
    '[InternetShortcut]\r\nURL=https://docs.dev/\r\nTitle=Docs\r\nNib-Added=2026-01-01T00:00:00.000Z\r\nNib-Icon=data:image/png;base64,AA\r\n',
  '/space/Team.chat': `{"v":1,"chat":"${CHAT}"}\n`,
  '/space/Server.term': '{"v":1,"machine":"m_1","session":"s_1"}\n',
  '/space/Damaged.chat': 'Team\n',
}

let notes: Record<string, string> = { ...SPACE }

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

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
    await setFileIcon('/space/plain.md', 'rocket')

    expect(written('/space/plain.md')).toBe('---\nicon: rocket\n---\n# Plain\n\nwords\n')
  })

  test('an emoji YAML would read as something else is quoted', async () => {
    fresh()
    await setFileIcon('/space/plain.md', '#\uFE0F\u20E3')

    expect(written('/space/plain.md')).toBe("---\nicon: '#\uFE0F\u20E3'\n---\n# Plain\n\nwords\n")
  })

  test('an emoji the note already wears in other quotes writes nothing at all', async () => {
    fresh()
    notes['/space/plain.md'] = '---\nicon: "#\uFE0F\u20E3"\n---\n# Plain\n'
    await setFileIcon('/space/plain.md', '#\uFE0F\u20E3')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  test('joins the keys a note already had', async () => {
    fresh()
    await setFileIcon('/space/titled.md', 'file-text')

    expect(written('/space/titled.md')).toBe(
      '---\ntitle: Titled\nicon: file-text\n---\n\n# Titled\n',
    )
  })

  test('replaces the one that was there', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'anchor')

    expect(written('/space/marked.md')).toBe('---\nicon: anchor\n---\n\n# Marked\n')
  })

  test('keeps the words that were there before it', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'compass')

    const touched = sent.filter((one) => one.path === '/space/marked.md')
    expect(touched.map((one) => one.command)).toEqual([
      'read_note',
      'read_note',
      'snapshot_note',
      'write_note',
    ])
    expect(touched[2]?.content).toContain('icon: rocket')
  })

  test('and is one thing to undo', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'feather')

    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('choosing the icon a note already wears writes nothing at all', async () => {
    fresh()
    await setFileIcon('/space/marked.md', 'feather')
    sent.length = 0

    await setFileIcon('/space/marked.md', 'feather')
    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

describe('the icon a web note is given', () => {
  test('is written into its file, and taken away again', async () => {
    fresh()
    await setFileIcon('/space/Docs.url', 'rocket', 'violet')
    const chosen = written('/space/Docs.url') ?? ''
    expect(chosen).toContain('Nib-Chosen-Icon=rocket\r\n')
    expect(chosen).toContain('Nib-Chosen-Color=violet\r\n')
    expect(chosen).toContain('Nib-Icon=data:image/png;base64,AA\r\n')

    notes['/space/Docs.url'] = chosen
    sent.length = 0
    await setFileIcon('/space/Docs.url', null)
    expect(written('/space/Docs.url')).toBe(SPACE['/space/Docs.url'])
  })
})

describe('the icon an open web note is given', () => {
  test('is written where it belongs, and the tab holds what the file says', async () => {
    fresh()
    await workspace.open('/space/Docs.url')
    expect(workspace.tabs.some((one) => one.path === '/space/Docs.url')).toBe(true)

    await setFileIcon('/space/Docs.url', 'rocket')

    const file = written('/space/Docs.url') ?? ''
    expect(file).toBe(`${SPACE['/space/Docs.url'] ?? ''}Nib-Chosen-Icon=rocket\r\n`)
    expect(workspace.tabs.find((one) => one.path === '/space/Docs.url')?.doc).toBe(
      file.replace(/\r\n/g, '\n'),
    )
  })
})

describe('the icon an online terminal is given', () => {
  test('is written into its file, and taken away again', async () => {
    fresh()
    await setFileIcon('/space/Server.term', 'rocket', 'violet')
    const chosen = written('/space/Server.term') ?? ''
    expect(JSON.parse(chosen)).toEqual({
      v: 1,
      machine: 'm_1',
      session: 's_1',
      icon: 'rocket',
      iconColor: 'violet',
    })

    notes['/space/Server.term'] = chosen
    sent.length = 0
    await setFileIcon('/space/Server.term', null)
    expect(written('/space/Server.term')).toBe(SPACE['/space/Server.term'])
  })
})

describe('taking a note s icon away', () => {
  test('takes the key with it', async () => {
    fresh()
    await setFileIcon('/space/titled.md', 'rocket')
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

describe('a note that is open while its icon changes', () => {
  test('takes the change in its own document, and stays saved', async () => {
    fresh()
    await workspace.open('/space/plain.md')
    await setFileIcon('/space/plain.md', 'rocket')

    const tab = workspace.tabs.find((one) => one.path === '/space/plain.md')
    expect(tab?.doc).toBe('---\nicon: rocket\n---\n# Plain\n\nwords\n')
    expect(tab?.dirty).toBe(false)
  })

  test('and undoing puts the note back the way its reader had it', async () => {
    fresh()
    await workspace.open('/space/titled.md')
    await setFileIcon('/space/titled.md', 'rocket')
    await workspace.undoFileAction()

    expect(workspace.tabs.find((one) => one.path === '/space/titled.md')?.doc).toBe(
      '---\ntitle: Titled\n---\n\n# Titled\n',
    )
  })
})

describe('the icon a canvas is given', () => {
  const board = (path: string) => readCanvas(written(path) ?? '')

  test('goes under the key that carries the ink', async () => {
    fresh()
    await setFileIcon('/space/Board.canvas', 'file-text')

    expect(board('/space/Board.canvas').icon).toBe('file-text')
  })

  test('and the cards, the edges and the spec half are left as they were', async () => {
    fresh()
    await setFileIcon('/space/Board.canvas', 'rocket')

    const parsed = JSON.parse(written('/space/Board.canvas') ?? '') as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'nib'])
    expect(parsed.nodes).toEqual([])
  })

  test('replaces the one that was there', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'anchor')

    expect(board('/space/Marked.canvas').icon).toBe('anchor')
  })

  test('keeps the version that was there before it, and is one thing to undo', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'compass')

    const touched = sent.filter((one) => one.path === '/space/Marked.canvas')
    expect(touched.map((one) => one.command)).toEqual([
      'read_note',
      'read_note',
      'snapshot_note',
      'write_note',
    ])
    expect(touched[2]?.content).toContain('"icon": "rocket"')
    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('and taking it away leaves the file exactly as it was before', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', null)

    expect(written('/space/Marked.canvas')).toBe(BOARD)
  })

  test('choosing the one it already wears writes nothing at all', async () => {
    fresh()
    await setFileIcon('/space/Marked.canvas', 'rocket')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  test('reaches a canvas that is open, without leaving it unsaved', async () => {
    fresh()
    await workspace.open('/space/Board.canvas')
    await setFileIcon('/space/Board.canvas', 'rocket')

    const tab = workspace.tabs.find((one) => one.path === '/space/Board.canvas')
    expect(readCanvas(tab?.doc ?? '').icon).toBe('rocket')
    expect(tab?.dirty).toBe(false)
  })
})

describe('what each kind of icon is written as', () => {
  test('an emoji, as the character it is', async () => {
    fresh()
    await setFileIcon('/space/plain.md', '🚀')

    expect(written('/space/plain.md')).toBe('---\nicon: 🚀\n---\n# Plain\n\nwords\n')
  })

  test('a drawing out of another set, under that set s own name', async () => {
    fresh()
    await setFileIcon('/space/plain.md', 'flat-color-icons:calendar')

    expect(written('/space/plain.md')).toContain('icon: flat-color-icons:calendar')
  })

  test('and a line icon with a colour, as two keys in one write', async () => {
    fresh()
    await setFileIcon('/space/plain.md', 'rocket', 'violet')

    expect(written('/space/plain.md')).toBe(
      '---\nicon: rocket\nicon-color: violet\n---\n# Plain\n\nwords\n',
    )
    expect(sent.filter((one) => one.command === 'write_note')).toHaveLength(1)
    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('a colour this build has never heard of is not written at all', async () => {
    fresh()
    await setFileIcon('/space/plain.md', 'rocket', 'chartreuse')

    expect(written('/space/plain.md')).toBe('---\nicon: rocket\n---\n# Plain\n\nwords\n')
  })

  test('and taking the icon away takes the colour with it', async () => {
    fresh()
    await setFileIcon('/space/plain.md', 'rocket', 'violet')
    await setFileIcon('/space/plain.md', null)

    expect(written('/space/plain.md')).toBe('# Plain\n\nwords\n')
  })

  test('a canvas keeps the colour beside the icon, under the same key', async () => {
    fresh()
    await setFileIcon('/space/Board.canvas', 'rocket', 'violet')

    const written = readCanvas(
      sent.filter((one) => one.command === 'write_note').pop()?.content ?? '',
    )
    expect(written.icon).toBe('rocket')
    expect(written.iconColor).toBe('violet')
  })
})

describe('the icon a chat is given', () => {
  test('goes into its pointer after the id, with its colour', async () => {
    fresh()
    await setFileIcon('/space/Team.chat', 'rocket', 'violet')

    expect(written('/space/Team.chat')).toBe(
      `{"v":1,"chat":"${CHAT}","icon":"rocket","iconColor":"violet"}\n`,
    )
  })

  test('keeps the version that was there before it, and is one thing to undo', async () => {
    fresh()
    await setFileIcon('/space/Team.chat', '🚀')

    const touched = sent.filter((one) => one.path === '/space/Team.chat')
    expect(touched.map((one) => one.command)).toEqual([
      'read_note',
      'read_note',
      'snapshot_note',
      'write_note',
    ])
    expect(touched[2]?.content).toBe(`{"v":1,"chat":"${CHAT}"}\n`)
    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('and taking it away leaves the pointer exactly as it was made', async () => {
    fresh()
    await setFileIcon('/space/Team.chat', 'rocket', 'violet')
    await setFileIcon('/space/Team.chat', null)

    expect(written('/space/Team.chat')).toBe(`{"v":1,"chat":"${CHAT}"}\n`)
  })

  test('choosing the one it already wears writes nothing at all', async () => {
    fresh()
    notes['/space/Team.chat'] = `{"v":1,"chat":"${CHAT}","icon":"rocket"}\n`
    await setFileIcon('/space/Team.chat', 'rocket')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })

  test('a file that is no pointer is not written to', async () => {
    fresh()
    await setFileIcon('/space/Damaged.chat', 'rocket')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})
