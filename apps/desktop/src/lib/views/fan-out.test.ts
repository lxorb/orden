import { type Group, readBase, type Row } from '@orden/bases'
import { describe, expect, test } from 'vitest'
import { columnsOf } from './columns'
import { dropInto } from './drop'
import { taskRow } from './fixture'
import { distinctKeys, everyRow, listItems } from './list-items'

/** A row under each of its labels (#1046): `answer` hands the same row to several groups,
 *  and everything that draws or counts them has to know. */

const OPTIONS = { grouped: true, folded: new Set<string>(), shut: new Set<string>(), adding: true }
const TWO = taskRow('E.md', '- [ ] Alpha #a #b', 1)
const ONE = taskRow('E.md', '- [ ] Beta #a', 2)

const under = (key: string | null, ...rows: Row[]): Group => ({ key, rows, summaries: {} })

describe('a row under two groups', () => {
  test('has a key of its own in each, so the list can draw', () => {
    const items = listItems([under('a', TWO, ONE), under('b', TWO)], OPTIONS)
    const ids = items.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(items.filter((one) => one.kind === 'row')).toHaveLength(3)
  })

  test('and a row under one group keeps the key it always had, wherever it moves', () => {
    const at = (groups: Group[]) =>
      listItems(groups, OPTIONS).find((one) => one.kind === 'row' && one.row === ONE)?.id
    expect(at([under('a', ONE)])).toBe(at([under('b', ONE)]))
  })

  test('the table has a key for it in each too', () => {
    const key = distinctKeys()
    const keys = [key(TWO, 'a'), key(ONE, 'a'), key(TWO, 'b')]
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe(distinctKeys()(TWO, 'b'))
  })

  test('whatever its id, no two rows are ever given one key', () => {
    const key = distinctKeys()
    const twice = [key(TWO, 'a'), key(TWO, 'a'), key(TWO, 'a')]
    expect(new Set(twice).size).toBe(3)
  })

  test('a layout with no groups of its own draws it once', () => {
    expect(everyRow([under('a', TWO, ONE), under('b', TWO)])).toEqual([TWO, ONE])
  })
})

describe('a row carried out of a group of a list', () => {
  const today = '2026-11-04'

  test('swaps that label alone', () => {
    expect(dropInto('task.tags', 'c', TWO, today, 'a')).toEqual({
      change: { task: { tags: ['b', 'c'] } },
    })
  })

  test('to no label loses that one', () => {
    expect(dropInto('task.tags', null, TWO, today, 'a')).toEqual({
      change: { task: { tags: ['b'] } },
    })
  })

  test('out of the group of no label keeps what it has', () => {
    expect(dropInto('task.tags', 'c', TWO, today, null)).toEqual({
      change: { task: { tags: ['a', 'b', 'c'] } },
    })
  })
})

describe('a list a file names twice', () => {
  test('a column is drawn once', () => {
    const base = readBase('views:\n  - type: table\n    name: T\n    order: [a, b, a]\n')
    expect(columnsOf(base, 0, [])).toEqual(['a', 'b'])
  })
})

describe('two spaces with one path', () => {
  test('both rows stand in a list', () => {
    const mine = taskRow('E.md', '- [ ] Mine', 1, { space: 'A' })
    const theirs = taskRow('E.md', '- [ ] Theirs', 1, { space: 'B' })
    const rows = listItems([under(null, mine, theirs)], { ...OPTIONS, grouped: false }).filter(
      (one) => one.kind === 'row',
    )
    expect(rows).toHaveLength(2)
  })
})
