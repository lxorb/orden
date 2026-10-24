/** Where quick add may write.
 *
 *  A task goes into the space in front, or the one it was handed, and a space shared
 *  with this account to be read is one nothing may be written in: the copy here would
 *  stop being the space's, and the sync would refuse the change on every pass. So the
 *  add answers nothing and writes nothing there, the way the file list's menu offers
 *  nothing to make there. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const SPACE = '/Theirs'

/** The spaces shared with this account to be read, by root. */
const readOnly = new Set<string>()
vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const written: string[] = []
const made: string[] = []

vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeSpace: { id: 'theirs', name: 'Theirs', root: SPACE },
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
    made.push(`${root}/Inbox.md`)
    return Promise.resolve(`${root}/Inbox.md`)
  },
}))

const { addTask } = await import('./write')

/** A task as the grammar reads `Call Ada`, with `>` naming `note` where one is given. */
function entry(note?: string) {
  return { text: 'Call Ada', fields: { remind: [], tags: [] }, ...(note ? { note } : {}) }
}

beforeEach(() => {
  readOnly.clear()
  written.length = 0
  made.length = 0
})

describe('a task added', () => {
  test('goes into the inbox of a space that may be written in', async () => {
    expect(await addTask(entry())).not.toBeNull()
    expect(written).toEqual([`${SPACE}/Inbox.md`])
  })

  test('goes nowhere in a space shared to be read, and makes no inbox there', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry())).toBeNull()
    expect(written).toEqual([])
    expect(made).toEqual([])
  })

  test('makes no note a `>` names there either', async () => {
    readOnly.add(SPACE)

    expect(await addTask(entry('Later'))).toBeNull()
    expect(made).toEqual([])
  })
})
