import { expect, test, vi } from 'vitest'

vi.mock('../../workspace/src/api', () => ({ workspace: { spaces: [] } }))
vi.mock('../../rows/src/api', () => ({ rows: {} }))
vi.mock('./templates', () => ({}))

const { groupProperties } = await import('./add')

test('a note added in a group carries the group’s value, a truth or a date as much as a word', () => {
  expect(groupProperties({ property: 'note.status', key: 'Doing' })).toEqual({ status: 'Doing' })
  expect(groupProperties({ property: 'note.size', key: 3 })).toEqual({ size: 3 })
  expect(groupProperties({ property: 'note.done', key: true })).toEqual({ done: true })
  expect(groupProperties({ property: 'note.done', key: false })).toEqual({ done: false })
  expect(
    groupProperties({ property: 'note.due', key: { kind: 'date', iso: '2026-03-05' } }),
  ).toEqual({ due: '2026-03-05' })
})

test('a group of no value, or of a field that is not the note’s, gives nothing', () => {
  expect(groupProperties({ property: 'note.status', key: null })).toEqual({})
  expect(groupProperties({ property: 'file.folder', key: 'Books' })).toEqual({})
  expect(groupProperties(undefined)).toEqual({})
})
