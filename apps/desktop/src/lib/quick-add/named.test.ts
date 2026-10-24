/** Which note a `>` in quick add names.
 *
 *  The space's list holds more than notes: a chat, a canvas, a website shortcut. A
 *  task line written into one of those is a file spoiled, so only a note is one a `>`
 *  can name; words naming anything else make the note a link would make. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const SPACE = '/Mine'

const written: string[] = []
const made: string[] = []

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeSpace: { id: 'mine', name: 'Mine', root: SPACE },
    notes: [{ path: `${SPACE}/Team.chat`, name: 'Team.chat' }],
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

const { addTask } = await import('./write')

beforeEach(() => {
  written.length = 0
  made.length = 0
})

describe('a `>` in quick add', () => {
  test('never names a file that is not a note', async () => {
    const entry = { text: 'Call Ada', fields: { remind: [], tags: [] }, note: 'Team.chat' }

    const went = await addTask(entry)

    expect(went?.path).not.toBe(`${SPACE}/Team.chat`)
    expect(written).not.toContain(`${SPACE}/Team.chat`)
  })
})
