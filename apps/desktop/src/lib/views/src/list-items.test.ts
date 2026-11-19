import * as bases from '@orden/bases'
import { describe, expect, test, vi } from 'vitest'
import { taskRow } from './fixture'
import { laneKeys, listItems } from './list-items'

vi.mock('@orden/bases', { spy: true })

const TASKS = 5_000

test('the list of 5,000 tasks drawn again after a tick names each row about twice, not once per step of its tree', () => {
  const parent = taskRow('Big.md', '- [ ] Everything', 0)
  const rows = [
    parent,
    ...Array.from({ length: TASKS - 1 }, (_, at) =>
      taskRow('Big.md', `  - [ ] Task ${at}`, at + 1, at % 2 ? { parent: 0, indent: 2 } : {}),
    ),
  ]
  vi.mocked(bases.rowId).mockClear()

  const items = listItems([{ key: null, rows, summaries: {} }], {
    grouped: false,
    folded: new Set(),
    shut: new Set(),
    adding: false,
  })

  expect(items).toHaveLength(TASKS)
  expect(items.filter((one) => one.kind === 'row' && one.depth === 1)).toHaveLength(Math.floor((TASKS - 1) / 2))
  expect(vi.mocked(bases.rowId).mock.calls.length).toBeLessThanOrEqual(TASKS * 2 + 1)
})

describe('the lanes of a board', () => {
  const lane = (key: bases.Group['key']): bases.Group => ({ key, rows: [], summaries: {} })
  const columns: bases.Group[] = [
    { key: 'Doing', rows: [], summaries: {}, sub: [lane(1), lane(3), lane(null)] },
    { key: 'Todo', rows: [], summaries: {}, sub: [lane(2)] },
  ]

  test('come in the order the answer gives across every column', () => {
    expect(laneKeys(columns, [1, 2, 3, null])).toEqual([1, 2, 3, null])
  })

  test('leave out a lane no shown column holds', () => {
    expect(laneKeys(columns.slice(1), [1, 2, 3, null])).toEqual([2])
  })
})
