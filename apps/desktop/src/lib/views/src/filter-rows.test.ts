import { expect, test } from 'vitest'
import { filterOf, type HoldsOf, rowsOf, withProperty } from './filter-rows'

const text: HoldsOf = (property) => (property === 'note.count' ? 'number' : 'other')
test('a quoted value that reads like a number stays quoted when another row changes', () => {
  const rows = rowsOf({ and: ['note.zip == "007"'] })
  const added = {
    ...rows,
    rows: [...rows.rows, { property: 'note.done', op: '==' as const, value: 'x' }],
  }
  expect(filterOf(added)).toEqual({ and: ['note.zip == "007"', 'note.done == "x"'] })
})
test('a quoted true stays a word, and a bare one stays a truth', () => {
  const rows = rowsOf({ or: ['note.flag == "true"', 'note.seen == true'] })
  expect(filterOf({ ...rows, join: 'and' })).toEqual({
    and: ['note.flag == "true"', 'note.seen == true'],
  })
})
test('a number in a list stays a number when another row changes', () => {
  const rows = rowsOf({ and: ['note.ratings.contains(5)'] }, text)
  const added = {
    ...rows,
    rows: [...rows.rows, { property: 'note.title', op: '==' as const, value: 'x' }],
  }
  expect(filterOf(added, text)).toEqual({ and: ['note.ratings.contains(5)', 'note.title == "x"'] })
})
test('a quoted value moved to another property is read afresh', () => {
  const [row] = rowsOf('note.zip == "007"').rows
  if (!row || 'kept' in row) throw new Error('no row')
  expect(filterOf({ join: 'and', rows: [{ ...withProperty(row, 'note.count'), value: '5' }] })).toBe('note.count == 5')
})
test('a date typed for a text property is still read as a date', () => {
  expect(filterOf({ join: 'and', rows: [{ property: 'note.due', op: '<', value: '2026-03-05' }] }, text)).toBe(
    'note.due < date("2026-03-05")',
  )
})
