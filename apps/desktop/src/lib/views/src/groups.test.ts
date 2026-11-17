import { readBase } from '@orden/bases'
import { describe, expect, test } from 'vitest'
import { forgottenGroup, renamedGroup } from './edit'

const base = readBase(`views:
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    orden:
      order:
        a: [z.md]
        b: [x.md, y.md]
      hidden: [a]
      groups: [b, a, c]
`)

describe('a column renamed, merged or deleted', () => {
  test('a rename keeps its order, its hiding and its place', () => {
    const orden = renamedGroup(base, 'note.status', 'a', 'd').views[0]?.orden
    expect(orden?.order).toEqual({ b: ['x.md', 'y.md'], d: ['z.md'] })
    expect(orden?.hidden).toEqual(['d'])
    expect(orden?.groups).toEqual(['b', 'd', 'c'])
  })

  test('a merge keeps both orders, the target first, and does not hide the target', () => {
    const orden = renamedGroup(base, 'status', 'a', 'b', true).views[0]?.orden
    expect(orden?.order).toEqual({ b: ['x.md', 'y.md', 'z.md'] })
    expect(orden?.hidden).toEqual([])
    expect(orden?.groups).toEqual(['b', 'c'])
  })

  test('a deleted option leaves no key behind', () => {
    const orden = forgottenGroup(base, 'note.status', 'a').views[0]?.orden
    expect(orden?.order).toEqual({ b: ['x.md', 'y.md'] })
    expect(orden?.hidden).toEqual([])
    expect(orden?.groups).toEqual(['b', 'c'])
  })
})
