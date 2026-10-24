import { beforeEach, describe, expect, test, vi } from 'vitest'

/** One note out of another, and two notes into one, driven by a stand-in store.
 *
 *  What the words become is composer.test.ts. What is here is everything around
 *  that: which files are written and in which order, that a snapshot of each is
 *  kept first, that the links which pointed at a note that went away are moved
 *  before it goes, and that either gesture is one thing to undo. */

const sent: string[] = []
const told: string[] = []
const disk = new Map<string, string>()

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push(`${command} ${path}`)

    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }

    if (command === 'write_note') disk.set(path, content)
    if (command === 'delete_note') disk.delete(path)
    return Promise.resolve('')
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void told.push(`saved ${path}`),
  },
}))

/** The spaces shared with this account to be read, by root. What may be written
 *  where is sharing.svelte.ts's, which wants an account a unit test has none of. */
const readOnly = new Set<string>()
vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) => ![...readOnly].some((root) => path.startsWith(`${root}/`)),
}))

const { freePath } = await import('@nib/markdown/paths')
const { extractSelection, mergeInto, splitAtCaret } = await import('./composing')
const { FileActions } = await import('./undo.svelte')
type Composes = import('./composing').Composes

const SPACE = '/space'
const OTHER = '/other'

/** A store with the given notes on its disk, and the first of them open. */
function space(notes: Record<string, string>, openAt?: string) {
  disk.clear()
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)

  const tab = openAt ? { id: 't1', path: openAt, doc: notes[openAt] ?? '' } : null

  const ws = {
    activeSpace: { id: 's1', name: 'space', root: SPACE },
    active: tab,
    tabs: tab ? [tab] : [],
    undone: new FileActions(),
    flush: () => undefined,
    // Said once to everything kept by path, the tabs of it among them; see
    // workspace/file-ops.ts.
    fileGone: (path: string) => {
      told.push(`gone ${path}`)
      return Promise.resolve()
    },
    reload: (path: string) => void told.push(`reloaded ${path}`),
    retarget: (from: string, to: string) => {
      told.push(`retargeted ${from} -> ${to}`)
      return Promise.resolve(1)
    },
    open: (path: string) => {
      told.push(`opened ${path}`)
      return Promise.resolve()
    },
    // The store's own numbering, which is `freePath` over everything the space
    // holds and the disk; see `freeNameOnDisk` in workspace.svelte.ts.
    freeNameOnDisk: (dir: string, wanted: string) =>
      Promise.resolve(freePath(wanted, (candidate) => disk.has(`${dir}/${candidate}`))),
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }

  return ws as unknown as Composes
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  readOnly.clear()
})

describe('a note merged into another', () => {
  const A = `${SPACE}/a.md`
  const B = `${SPACE}/b.md`

  test('appends, moves the links before the note goes, and opens the one that is left', async () => {
    const ws = space({ [A]: '# a\n\nfirst\n', [B]: '# b\n\nsecond\n' })
    await mergeInto(ws, A, B)

    expect(disk.get(B)).toContain('first')
    expect(disk.has(A)).toBe(false)
    // The snapshot of each note comes before that note is written or deleted, and
    // the links move while the note they point at is still findable.
    expect(sent).toEqual([
      `read_note ${A}`,
      `read_note ${B}`,
      `snapshot_note ${B}`,
      `write_note ${B}`,
      // What B says once the links are rewritten, which is what an undo checks it
      // against.
      `read_note ${B}`,
      `snapshot_note ${A}`,
      `delete_note ${A}`,
    ])
    expect(told).toEqual([
      `saved ${B}`,
      `reloaded ${B}`,
      `retargeted ${A} -> ${B}`,
      `gone ${A}`,
      `opened ${B}`,
    ])
  })

  test('is one thing to undo, holding both notes as they were', async () => {
    const ws = space({ [A]: '# a\n', [B]: '# b\n' })
    await mergeInto(ws, A, B)

    expect(ws.undone.stack).toEqual([
      // Nothing linked to A here, so no note's links are to put back.
      {
        kind: 'merge',
        from: A,
        fromContent: '# a\n',
        into: B,
        intoContent: '# b\n',
        intoAfter: disk.get(B),
        relinked: [],
      },
    ])
  })

  test('and a note merged into itself does nothing at all', async () => {
    const ws = space({ [A]: '# a\n' })
    await mergeInto(ws, A, A)

    expect(sent).toEqual([])
    expect(ws.undone.stack).toEqual([])
  })

  test('and a note that cannot be read is left alone', async () => {
    const ws = space({ [A]: '# a\n' })
    await mergeInto(ws, A, `${SPACE}/gone.md`)

    expect(disk.get(A)).toBe('# a\n')
    expect(ws.undone.stack).toEqual([])
  })
})

describe('a merge that may not be made', () => {
  const A = `${SPACE}/a.md`
  const B = `${SPACE}/b.md`

  test('leaves both notes alone in a space shared to be read', async () => {
    readOnly.add(SPACE)
    const ws = space({ [A]: '# a\n', [B]: '# b\n' })
    await mergeInto(ws, A, B)

    expect(sent).toEqual([])
    expect(disk.get(A)).toBe('# a\n')
    expect(ws.undone.stack).toEqual([])
  })

  test('leaves a note of another space where it is', async () => {
    // A tab outlives a switch of space, so the note in front of the reader can be
    // one the open space does not hold, while the notes on offer are the open one's.
    const away = `${OTHER}/a.md`
    const ws = space({ [away]: '# a\n', [B]: '# b\n' })
    await mergeInto(ws, away, B)

    expect(sent).toEqual([])
    expect(disk.get(away)).toBe('# a\n')
    expect(disk.get(B)).toBe('# b\n')
  })

  test('and does not reach into another space either', async () => {
    const away = `${OTHER}/b.md`
    const ws = space({ [A]: '# a\n', [away]: '# b\n' })
    await mergeInto(ws, A, away)

    expect(sent).toEqual([])
    expect(disk.has(A)).toBe(true)
  })
})

describe('a note split at the caret', () => {
  const NOTE = `${SPACE}/plan.md`
  const DOC = '# Plan\n\nfirst\n\n## Later\n\nsecond\n'

  test('writes the new note, then what is left of this one', async () => {
    const ws = space({ [NOTE]: DOC }, NOTE)
    await splitAtCaret(ws, DOC.indexOf('## Later'))

    const made = [...disk.keys()].find((path) => path !== NOTE)
    expect(made).toBeDefined()
    expect(disk.get(made ?? '')).toContain('second')
    expect(disk.get(NOTE)).toContain('first')
    expect(disk.get(NOTE)).not.toContain('second')
  })

  test('is one thing to undo, holding the note as it was', async () => {
    const ws = space({ [NOTE]: DOC }, NOTE)
    await splitAtCaret(ws, DOC.indexOf('## Later'))

    expect(ws.undone.stack).toHaveLength(1)
    expect(ws.undone.stack[0]).toMatchObject({ kind: 'split', from: NOTE, fromContent: DOC })
  })

  test('and steps the new name aside from one the folder already has', async () => {
    // The name a split reaches for, taken. Numbered the way every other name in
    // the app is - a space and a digit before the extension.
    const ws = space({ [NOTE]: DOC, [`${SPACE}/Later.md`]: '# taken' }, NOTE)
    await splitAtCaret(ws, DOC.indexOf('## Later'))

    expect(disk.has(`${SPACE}/Later 2.md`)).toBe(true)
    expect(disk.get(`${SPACE}/Later.md`)).toBe('# taken')
  })

  test('and the link left behind names the stepped-aside note, not the one it stepped from', async () => {
    // The link was written from the name the split reached for, so the note was
    // left pointing at an unrelated `Later` and nothing pointed at `Later 2`.
    const ws = space({ [NOTE]: DOC, [`${SPACE}/Later.md`]: '# taken' }, NOTE)
    await splitAtCaret(ws, DOC.indexOf('## Later'))

    expect(disk.get(NOTE)).toContain('[[Later 2]]')
    expect(disk.get(NOTE)).not.toContain('[[Later]]')
  })

  test('and nothing happens where there is nothing after the caret', async () => {
    const ws = space({ [NOTE]: DOC }, NOTE)
    await splitAtCaret(ws, DOC.length)

    expect(sent).toEqual([])
    expect(ws.undone.stack).toEqual([])
  })

  test('and nothing happens in a pane holding no file', async () => {
    const ws = space({ [NOTE]: DOC })
    await splitAtCaret(ws, 3)

    expect(sent).toEqual([])
  })
})

describe('a selection made into a note of its own', () => {
  const NOTE = `${SPACE}/plan.md`
  const DOC = '# Plan\n\nkeep this\n\ntake this\n'

  test('leaves a link where the words were', async () => {
    const ws = space({ [NOTE]: DOC }, NOTE)
    const from = DOC.indexOf('take this')
    await extractSelection(ws, from, from + 'take this'.length)

    expect(disk.get(NOTE)).toContain('keep this')
    expect(disk.get(NOTE)).toMatch(/\[\[.+]]/)
    expect(ws.undone.stack[0]).toMatchObject({ kind: 'extract', from: NOTE })
  })

  test('and links to the note by the name it was stepped aside to', async () => {
    // The passage is the name, so the link would be left plain; once the name is
    // taken the passage stays as the link's words and the target is the new note.
    const doc = '# Plan\n\nkeep this\n\nLater\n'
    const ws = space({ [NOTE]: doc, [`${SPACE}/Later.md`]: '# taken' }, NOTE)
    const from = doc.indexOf('Later')
    await extractSelection(ws, from, from + 'Later'.length)

    expect(disk.has(`${SPACE}/Later 2.md`)).toBe(true)
    expect(disk.get(NOTE)).toContain('[[Later 2|Later]]')
  })

  test('and nothing happens where nothing is selected', async () => {
    const ws = space({ [NOTE]: DOC }, NOTE)
    await extractSelection(ws, 4, 4)

    expect(sent).toEqual([])
  })
})
