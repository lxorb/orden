import { describe, expect, test } from 'vitest'
import { filterOf, rowsOf } from './filter-rows'

describe('a filter that starts with today()', () => {
  test('is kept whole when another row is added in the builder', () => {
    const rows = rowsOf('task.due < today() && !task.done')
    expect(
      filterOf({
        ...rows,
        rows: [...rows.rows, { property: 'note.status', op: '==', value: 'x' }],
      }),
    ).toEqual({ and: ['task.due < today() && !task.done', 'note.status == "x"'] })
  })
  test('still reads a plain comparison with the clock as a row', () => {
    expect(rowsOf('task.due < today() + "7d"').rows).toEqual([
      { property: 'task.due', op: '<', value: 'today() + "7d"' },
    ])
  })
})
