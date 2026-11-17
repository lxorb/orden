import { describe, expect, test } from 'vitest'
import { RowIds } from './row-ids'

describe('a row id', () => {
  test('is the same for a path asked twice and another for another path', () => {
    const ids = new RowIds()
    expect(ids.idOf('/s/a.md')).toBe(ids.idOf('/s/a.md'))
    expect(ids.idOf('/s/a.md')).not.toBe(ids.idOf('/s/b.md'))
  })

  test('follows a rename, and a folder moved takes the rows inside it along', () => {
    const ids = new RowIds()
    const note = ids.idOf('/s/f/a.md')
    const folder = ids.idOf('/s/f')
    const other = ids.idOf('/s/f2/b.md')

    ids.moved('/s/f/a.md', '/s/f/z.md')
    ids.moved('/s/f', '/s/g/f')

    expect(ids.idOf('/s/g/f/z.md')).toBe(note)
    expect(ids.idOf('/s/g/f')).toBe(folder)
    expect(ids.idOf('/s/f2/b.md')).toBe(other)
    expect(ids.peek('/s/f/a.md')).toBeUndefined()
    expect(ids.peek('/s/f')).toBeUndefined()
  })

  test('takes the place of a row the new path had', () => {
    const ids = new RowIds()
    const moving = ids.idOf('/s/a.md')
    ids.idOf('/s/b.md')
    ids.moved('/s/a.md', '/s/b.md')
    expect(ids.peek('/s/b.md')).toBe(moving)
  })

  test('goes with a delete, and the path comes back as another row', () => {
    const ids = new RowIds()
    const was = ids.idOf('/s/f/a.md')
    ids.gone('/s/f')
    expect(ids.peek('/s/f/a.md')).toBeUndefined()
    expect(ids.idOf('/s/f/a.md')).not.toBe(was)
  })
})
