import { describe, expect, test } from 'vitest'
import { answer, cellValue } from './answer'
import { readBase } from './base-file'
import { contextAt, noteRow } from './fixtures/rows'

const context = contextAt()
const plain = readBase('views:\n  - type: table\n    name: T\n')
describe('a property whose name reads like an expression', () => {
  const row = noteRow('a.md', 'due-date: 2026-01-01\nSize (cm): 4\na.b: deep\ne-mail: x@y.z')
  test('is read from the front matter key of that name', () => {
    expect(cellValue(plain, 'note.due-date', row, context)).toEqual({
      kind: 'date',
      iso: '2026-01-01',
    })
    expect(cellValue(plain, 'note.Size (cm)', row, context)).toBe(4)
    expect(cellValue(plain, 'note.a.b', row, context)).toBe('deep')
    expect(cellValue(plain, 'e-mail', row, context)).toBe('x@y.z')
  })
  test('groups by its values', () => {
    const base = readBase('views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.e-mail\n')
    const rows = [noteRow('a.md', 'e-mail: x'), noteRow('b.md', 'e-mail: y')]
    expect(answer(base, 'T', rows, context).groups.map((one) => one.key)).toEqual(['x', 'y'])
  })
  test('still reads a nested value or an expression when no key has that name', () => {
    const nested = noteRow('n.md', 'a:\n  b: inner\npages: 10\nread: 3')
    expect(cellValue(plain, 'note.a.b', nested, context)).toBe('inner')
    expect(cellValue(plain, 'note.pages-note.read', nested, context)).toBe(7)
  })
})
describe('a view that reads this', () => {
  test('answers again once the note it sits in changes', () => {
    const base = readBase('filters: status == this.status\nviews:\n  - type: table\n    name: T\n')
    const rows = [noteRow('a.md', 'status: open'), noteRow('b.md', 'status: closed')]
    const paths = (host: string) =>
      answer(base, 'T', rows, { ...context, this: noteRow('host.md', host) }).groups[0]?.rows.map((one) => one.path)
    expect(paths('status: open')).toEqual(['a.md'])
    expect(paths('status: closed')).toEqual(['b.md'])
  })
})
