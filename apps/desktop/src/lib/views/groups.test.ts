import { readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { forgottenGroup, renamedGroup } from './edit'

const base = readBase(`views:
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    nib:
      order:
        a: [z.md]
        b: [x.md, y.md]
      hidden: [a]
      groups: [b, a, c]
`)

describe('a column renamed, merged or deleted', () => {
  test('a rename keeps its order, its hiding and its place', () => {
    const nib = renamedGroup(base, 'note.status', 'a', 'd').views[0]?.nib
    expect(nib?.order).toEqual({ b: ['x.md', 'y.md'], d: ['z.md'] })
    expect(nib?.hidden).toEqual(['d'])
    expect(nib?.groups).toEqual(['b', 'd', 'c'])
  })

  test('a merge keeps both orders, the target first, and does not hide the target', () => {
    const nib = renamedGroup(base, 'status', 'a', 'b', true).views[0]?.nib
    expect(nib?.order).toEqual({ b: ['x.md', 'y.md', 'z.md'] })
    expect(nib?.hidden).toEqual([])
    expect(nib?.groups).toEqual(['b', 'c'])
  })

  test('a deleted option leaves no key behind', () => {
    const nib = forgottenGroup(base, 'note.status', 'a').views[0]?.nib
    expect(nib?.order).toEqual({ b: ['x.md', 'y.md'] })
    expect(nib?.hidden).toEqual([])
    expect(nib?.groups).toEqual(['b', 'c'])
  })
})

describe('a card of a list carried within its member', () => {
  test('writes nothing, and keeps the list as it was', async () => {
    const { dropInto } = await import('./drop')
    const { noteRow } = await import('./fixture')
    const row = noteRow('n.md', { tags: ['a', 'b'] })
    expect(dropInto('note.tags', 'a', row, '2026-10-19', 'a')).toBeNull()
    expect(dropInto('note.tags', 'c', row, '2026-10-19', 'a')).toEqual({
      change: { note: { tags: ['b', 'c'] } },
    })
  })
})
