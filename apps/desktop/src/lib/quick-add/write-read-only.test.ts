/** Where quick add may write.
 *
 *  A task goes into the reader's one inbox, a note of the space in front, or the space
 *  it was handed (#1153), and a space shared with this account to be read is one nothing
 *  may be written in: the copy here would stop being the space's, and the sync would
 *  refuse the change on every pass. So the add writes nothing there, the way the file
 *  list's menu offers nothing to make there. A task that names no note goes to the inbox
 *  of the first space that takes it instead, the way one from Shortcuts does; one that
 *  names a note, or was handed a space, is refused, and the field keeps it. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const SPACE = '/Theirs'
const MINE = '/Mine'

/** The spaces shared with this account to be read, by root, and those shared by it. */
const readOnly = new Set<string>()
const shared = new Set<string>()
vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
  roleOf: (root: string) => (readOnly.has(root) ? 'read' : 'owner'),
  isShared: (root: string) => shared.has(root),
}))

const front = { root: SPACE }

const written: string[] = []
const made: string[] = []

vi.mock('../workspace.svelte', () => ({
  workspace: {
    get activeSpace() {
      return front.root === SPACE
        ? { id: 'theirs', name: 'Theirs', root: SPACE }
        : { id: 'mine', name: 'Mine', root: MINE }
    },
    spaces: [
      { id: 'theirs', name: 'Theirs', root: SPACE },
      { id: 'mine', name: 'Mine', root: MINE },
    ],
    shownSpaces: [
      { id: 'theirs', name: 'Theirs', root: SPACE },
      { id: 'mine', name: 'Mine', root: MINE },
    ],
    notes: [{ path: `${SPACE}/Plan.md`, name: 'Plan.md' }],
    recent: [],
    loadTree: () => Promise.resolve(),
    fileCame: () => Promise.resolve(),
  },
}))
vi.mock('../link-index.svelte', () => ({ links: { held: () => [] } }))
vi.mock('../workspace/note-text', () => ({
  noteText: () => Promise.resolve(''),
  replaceInNotes: (_: unknown, changes: { path: string }[]) => {
    written.push(...changes.map((one) => one.path))
    return Promise.resolve()
  },
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string) => {
    made.push(path)
    return Promise.resolve()
  },
}))
vi.mock('../rows/inbox-note', () => ({
  inboxNote: (root: string) => {
    made.push(`${root}/.Inbox.md`)
    return Promise.resolve(`${root}/.Inbox.md`)
  },
}))

const { addTask } = await import('./write')

/** A task as the grammar reads `Call Ada`, with `>` naming `note` where one is given. */
function entry(note?: string) {
  return { text: 'Call Ada', fields: { remind: [], tags: [] }, ...(note ? { note } : {}) }
}

beforeEach(() => {
  front.root = SPACE
  shared.clear()
  readOnly.clear()
  written.length = 0
  made.length = 0
})

describe('a task added', () => {
  test('goes into the inbox of a space that may be written in', async () => {
    expect(await addTask(entry())).not.toBeNull()
    expect(written).toEqual([`${SPACE}/.Inbox.md`])
  })

  test('goes into the inbox of the first space that takes it, the one in front shared to be read', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry())).toEqual({ path: `${MINE}/.Inbox.md`, line: expect.any(Number) })
    expect(written).toEqual([`${MINE}/.Inbox.md`])
    expect(made).toEqual([`${MINE}/.Inbox.md`])
  })

  test('sent to `>Inbox` by name goes into the inbox, and makes no Inbox.md (#1044)', async () => {
    expect(await addTask(entry('Inbox'))).toEqual({
      path: `${SPACE}/.Inbox.md`,
      line: expect.any(Number),
    })
    expect(written).toEqual([`${SPACE}/.Inbox.md`])
    expect(made).toEqual([`${SPACE}/.Inbox.md`])
  })

  test('goes nowhere where no space takes it, and makes no inbox anywhere', async () => {
    readOnly.add(SPACE)
    readOnly.add(MINE)

    expect(await addTask(entry())).toBeNull()
    expect(written).toEqual([])
    expect(made).toEqual([])
  })

  test('makes no note a `>` names there either, nor elsewhere', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry('Later'))).toBeNull()
    expect(await addTask(entry('Plan'))).toBeNull()
    expect(made).toEqual([])
    expect(written).toEqual([])
  })

  test('goes nowhere in a space it was handed that is shared to be read', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry(), { root: SPACE })).toBeNull()
    expect(written).toEqual([])
  })
})

describe('a task that names no note (#1153)', () => {
  test('goes into the reader’s one inbox, whatever space is in front', async () => {
    shared.add(SPACE)
    expect(await addTask(entry())).toEqual({ path: `${MINE}/.Inbox.md`, line: expect.any(Number) })
    front.root = MINE
    expect(await addTask(entry())).toEqual({ path: `${MINE}/.Inbox.md`, line: expect.any(Number) })
    expect(written).toEqual([`${MINE}/.Inbox.md`, `${MINE}/.Inbox.md`])
  })

  test('the first space of the reader’s own where none is theirs alone', async () => {
    shared.add(SPACE)
    shared.add(MINE)
    front.root = MINE
    expect(await addTask(entry())).toEqual({ path: `${SPACE}/.Inbox.md`, line: expect.any(Number) })
  })

  test('but one handed a space by its add button goes into that space’s', async () => {
    shared.add(SPACE)
    expect(await addTask(entry(), { root: SPACE })).toEqual({
      path: `${SPACE}/.Inbox.md`,
      line: expect.any(Number),
    })
  })

  test('and one sent to a note goes into the note of the space in front', async () => {
    shared.add(SPACE)
    expect(await addTask(entry('Plan'))).toEqual({
      path: `${SPACE}/Plan.md`,
      line: expect.any(Number),
    })
  })
})
