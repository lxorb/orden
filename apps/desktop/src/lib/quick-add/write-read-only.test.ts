import { beforeEach, describe, expect, test, vi } from 'vitest'

const SPACE = '/Theirs'
const MINE = '/Mine'

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
    rootHolding: (path: string) => (path.startsWith(`${MINE}/`) ? MINE : SPACE),
    itemMeta: { of: () => null, set: () => undefined },
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
  writeIfAbsent: (path: string) => {
    made.push(path)
    return Promise.resolve(true)
  },
}))
vi.mock('../rows/inbox-note', () => ({
  inboxNote: async () => {
    const root = (await import('../rows/home.svelte')).homeRoot()
    if (root === null) return null
    made.push(`${root}/.orden-inbox.md`)
    return `${root}/.orden-inbox.md`
  },
}))

const { addTask } = await import('./write')

function entry() {
  return { text: 'Call Ada', fields: { remind: [], tags: [] } }
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
    expect(written).toEqual([`${SPACE}/.orden-inbox.md`])
  })

  test('goes into the inbox of the first space that takes it, the one in front shared to be read', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry())).toEqual({
      path: `${MINE}/.orden-inbox.md`,
      line: expect.any(Number),
    })
    expect(written).toEqual([`${MINE}/.orden-inbox.md`])
    expect(made).toEqual([`${MINE}/.orden-inbox.md`])
  })

  test('goes nowhere where no space takes it, and makes no inbox anywhere', async () => {
    readOnly.add(SPACE)
    readOnly.add(MINE)

    expect(await addTask(entry())).toBeNull()
    expect(written).toEqual([])
    expect(made).toEqual([])
  })
})

describe('a task that names no note (#1153)', () => {
  test('goes into the reader’s one inbox, whatever space is in front', async () => {
    shared.add(SPACE)
    expect(await addTask(entry())).toEqual({
      path: `${MINE}/.orden-inbox.md`,
      line: expect.any(Number),
    })
    front.root = MINE
    expect(await addTask(entry())).toEqual({
      path: `${MINE}/.orden-inbox.md`,
      line: expect.any(Number),
    })
    expect(written).toEqual([`${MINE}/.orden-inbox.md`, `${MINE}/.orden-inbox.md`])
  })

  test('the first space of the reader’s own where none is theirs alone', async () => {
    shared.add(SPACE)
    shared.add(MINE)
    front.root = MINE
    expect(await addTask(entry())).toEqual({
      path: `${SPACE}/.orden-inbox.md`,
      line: expect.any(Number),
    })
  })
})
