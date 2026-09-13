import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Writing across a space without opening it, driven by a stand-in store.
 *
 *  The four obligations are what this is about: the version about to be replaced is
 *  kept, the file is written, the index hears what it says now, and a pane that
 *  happens to be showing the note is handed the words that changed rather than the
 *  whole note. Plus the two callers that are only these in a different order - a
 *  task ticked from a row of search results, and a tag renamed everywhere. */

const sent: { command: string; path: string; content: string }[] = []
const told: string[] = []

/** What is on this disk, for the reads that do not go through an open document. */
const disk = new Map<string, string>()

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })

    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }

    if (command === 'write_note') disk.set(path, content)
    return Promise.resolve('')
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void told.push(`saved ${path}`),
    spaceTags: [{ path: 'work', count: 2 }],
    scanning: false,
    scanned: () => Promise.resolve(),
  },
}))

vi.mock('../sync.svelte', () => ({ sync: { nudge: () => void told.push('nudged') } }))

const { loadTags, noteText, replaceInNotes, toggleTaskAt } = await import('./note-text')
const { FileActions } = await import('./undo.svelte')
type HoldsNotes = import('./note-text').HoldsNotes

const SPACE = '/space'

/** A store with the given notes on its disk and, optionally, one of them open in a
 *  pane - which is the case the edits are for. */
function space(notes: Record<string, string>, openAt?: string) {
  disk.clear()
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)

  const edits: string[] = []
  const open = openAt
    ? [
        {
          path: openAt,
          text: notes[openAt] ?? '',
          edited: (_: unknown, after: string) => void edits.push(after),
        },
      ]
    : []

  const ws = {
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    notes: Object.keys(notes).map((path) => ({ path })),
    documents: open,
    undone: new FileActions(),
    tags: [],
    flushed: 0,
    flush() {
      this.flushed += 1
    },
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }

  return { ws: ws as unknown as HoldsNotes & { flushed: number }, edits }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
})

describe('a replacement across the space', () => {
  test('keeps what was there, writes what is, and says so once', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'before' })

    await replaceInNotes(ws, [
      {
        path: `${SPACE}/a.md`,
        before: 'before',
        after: 'after',
        edits: [{ from: 0, to: 6, insert: 'after' }],
        back: [{ from: 0, to: 5, insert: 'before' }],
      },
    ])

    expect(sent).toEqual([
      { command: 'snapshot_note', path: `${SPACE}/a.md`, content: 'before' },
      { command: 'write_note', path: `${SPACE}/a.md`, content: 'after' },
    ])
    expect(told).toEqual([`saved ${SPACE}/a.md`, 'nudged'])
    expect(ws.undone.stack).toEqual([
      {
        kind: 'replace',
        notes: [
          {
            path: `${SPACE}/a.md`,
            content: 'before',
            edits: [{ from: 0, to: 5, insert: 'before' }],
          },
        ],
      },
    ])
  })

  test('hands an open note the words that changed rather than the whole note', async () => {
    const { ws, edits } = space({ [`${SPACE}/a.md`]: 'before' }, `${SPACE}/a.md`)

    await replaceInNotes(ws, [
      {
        path: `${SPACE}/a.md`,
        before: 'before',
        after: 'after',
        edits: [{ from: 0, to: 6, insert: 'after' }],
        back: [{ from: 0, to: 5, insert: 'before' }],
      },
    ])

    expect(edits).toEqual(['after'])
  })

  test('and however many notes it touched, it is one thing to undo', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'x', [`${SPACE}/b.md`]: 'x' })

    await replaceInNotes(
      ws,
      ['a', 'b'].map((name) => ({
        path: `${SPACE}/${name}.md`,
        before: 'x',
        after: 'y',
        edits: [{ from: 0, to: 1, insert: 'y' }],
        back: [{ from: 0, to: 1, insert: 'x' }],
      })),
    )

    expect(ws.undone.stack).toHaveLength(1)
  })

  test('and nothing at all where there is nothing to change', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'x' })
    await replaceInNotes(ws, [])

    expect(sent).toEqual([])
    expect(ws.undone.stack).toEqual([])
  })
})

describe("a note's words as they stand", () => {
  test('are what is on screen when it is open, unwritten and all', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'on disk' }, `${SPACE}/a.md`)
    disk.set(`${SPACE}/a.md`, 'on disk')

    // The document says what the pane holds, which is what a replacement must not
    // write over.
    expect(await noteText(ws, `${SPACE}/a.md`)).toBe('on disk')
    expect(ws.flushed).toBe(1)
    expect(sent).toEqual([])
  })

  test('are read off the disk otherwise', async () => {
    const { ws } = space({ [`${SPACE}/a.md`]: 'on disk' })
    expect(await noteText(ws, `${SPACE}/a.md`)).toBe('on disk')
    expect(sent.map((one) => one.command)).toEqual(['read_note'])
  })

  test('and nothing at all for a note that is not there', async () => {
    const { ws } = space({})
    expect(await noteText(ws, `${SPACE}/gone.md`)).toBeNull()
  })
})

describe('a task ticked from a row', () => {
  const NOTE = `${SPACE}/todo.md`

  test('reads the line again rather than trusting the row', async () => {
    const { ws } = space({ [NOTE]: '# to do\n\n- [ ] wash up\n- [x] done\n' })

    expect(await toggleTaskAt(ws, NOTE, 2)).toBe(true)
    expect(disk.get(NOTE)).toBe('# to do\n\n- [x] wash up\n- [x] done\n')
  })

  test('and clears one that is ticked', async () => {
    const { ws } = space({ [NOTE]: '- [x] done\n' })

    expect(await toggleTaskAt(ws, NOTE, 0)).toBe(true)
    expect(disk.get(NOTE)).toBe('- [ ] done\n')
  })

  test('and says no where the line the row named holds no box now', async () => {
    const { ws } = space({ [NOTE]: '# to do\n\njust words\n' })

    expect(await toggleTaskAt(ws, NOTE, 2)).toBe(false)
    expect(sent.every((one) => one.command === 'read_note')).toBe(true)
  })

  test('and says no for a line the note does not have', async () => {
    const { ws } = space({ [NOTE]: '- [ ] one\n' })
    expect(await toggleTaskAt(ws, NOTE, 40)).toBe(false)
  })
})

describe("the space's tags", () => {
  test('come off the index', async () => {
    const { ws } = space({})
    await loadTags(ws)

    expect(ws.tags).toEqual([{ path: 'work', count: 2 }])
  })
})
