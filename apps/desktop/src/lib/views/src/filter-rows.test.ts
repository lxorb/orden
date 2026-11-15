import { expect, test } from 'vitest'
import { filterOf, type HoldsOf, rowsOf } from './filter-rows'

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

test('a number typed for a text property is compared as text, and for a number one as a number', () => {
  expect(
    filterOf(
      {
        join: 'and',
        rows: [
          { property: 'note.zip', op: '==', value: '007' },
          { property: 'note.count', op: '>', value: '3' },
        ],
      },
      text,
    ),
  ).toEqual({ and: ['note.zip == "007"', 'note.count > 3'] })
})

test('a date typed for a text property is still read as a date', () => {
  expect(
    filterOf({ join: 'and', rows: [{ property: 'note.due', op: '<', value: '2026-03-05' }] }, text),
  ).toBe('note.due < date("2026-03-05")')
})
