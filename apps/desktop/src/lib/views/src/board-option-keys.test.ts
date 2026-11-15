import { readBase, type Row } from '@orden/bases'
import { describe, expect, test, vi } from 'vitest'
import { noteRow } from './fixture'

const added: unknown[] = []
const dropped: unknown[] = []

vi.mock('./add', () => ({
  addNote: (_base: unknown, _at: number, _file: unknown, group: unknown) => {
    added.push(group)
    return Promise.resolve(null)
  },
}))
vi.mock('./act', () => ({
  dropRow: (_row: Row, drop: unknown) => {
    dropped.push(drop)
    return Promise.resolve(true)
  },
  writeRow: () => Promise.resolve(true),
}))

const { kitFor } = await import('./kit')

const base = readBase(
  'properties:\n  note.priority:\n    orden:\n      options: [1, 2, 3]\nviews:\n  - type: kanban\n    name: B\n    groupBy:\n      property: note.priority\n',
)

function kitOf(rows: readonly Row[]) {
  const live = { base, at: 0, view: base.views[0], writtenAt: null, fixed: false, rows }
  return kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, false)
}

describe('a board grouped by numeric options', () => {
  test('a card dropped in a column writes the number, not the words', () => {
    const row = noteRow('a.md', 'priority: 1')
    kitOf([row]).drop(row, '3', 'note.priority')
    expect(dropped).toEqual([{ change: { note: { priority: 3 } } }])
  })

  test('a note added in a column holds the number too', () => {
    kitOf([noteRow('a.md', 'priority: 1')]).add({ property: 'note.priority', key: '3' })
    expect(added).toEqual([{ property: 'note.priority', key: 3 }])
  })

  test('words that only look like a number stay words where the notes hold words', () => {
    const row = noteRow('a.md', 'priority: low')
    dropped.length = 0
    kitOf([row]).drop(row, '007', 'note.priority')
    expect(dropped).toEqual([{ change: { note: { priority: '007' } } }])
  })
})
