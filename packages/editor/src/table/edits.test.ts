import { describe, expect, test } from 'vitest'
import {
  alignedColumn,
  type Focus,
  insertedColumn,
  insertedRow,
  movedColumn,
  movedRow,
  removedColumn,
  removedRow,
} from './edits'
import { parseTable, type TableModel } from './model'

/** Three columns and two rows, so a caret can sit before, on, or after
 *  whichever one an edit is about. */
const MODEL: TableModel = parseTable(
  ['| a | b | c |', '| - | :-: | - |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join('\n'),
)!

const at = (row: number, column: number, offset = 0): Focus => ({ at: { row, column }, offset })

describe('the caret after a column goes', () => {
  test('follows its own text in from the right', () => {
    expect(removedColumn(MODEL, 0, at(0, 2)).focus).toEqual(at(0, 1))
    expect(removedColumn(MODEL, 1, at(0, 2)).focus).toEqual(at(0, 1))
  })

  test('stays where it is when the column that went was to its right', () => {
    expect(removedColumn(MODEL, 2, at(0, 0)).focus).toEqual(at(0, 0))
    expect(removedColumn(MODEL, 1, at(0, 0)).focus).toEqual(at(0, 0))
  })

  test('stays at the index of the column it was in', () => {
    expect(removedColumn(MODEL, 1, at(0, 1)).focus).toEqual(at(0, 1))
  })

  test('is clamped when the column it was in was the last one', () => {
    expect(removedColumn(MODEL, 2, at(0, 2)).focus).toEqual(at(0, 1))
  })

  test('keeps how far into the cell it was', () => {
    expect(removedColumn(MODEL, 0, at(1, 2, 3)).focus?.offset).toBe(3)
  })

  test('is left alone when nothing was removed', () => {
    const single = parseTable('| a |\n| - |\n| 1 |')!
    const edit = removedColumn(single, 0, at(0, 0))
    expect(edit.next).toBe(single)
  })
})

describe('the caret after a row goes', () => {
  test('follows its own text up from below', () => {
    expect(removedRow(MODEL, 0, at(1, 1)).focus).toEqual(at(0, 1))
  })

  test('stays where it is when the row that went was below it', () => {
    expect(removedRow(MODEL, 1, at(0, 1)).focus).toEqual(at(0, 1))
  })

  test('lands on the header when the last body row goes', () => {
    const one = parseTable('| a |\n| - |\n| 1 |')!
    expect(removedRow(one, 0, at(0, 0)).focus).toEqual(at(-1, 0))
  })
})

describe('the caret after something moves', () => {
  test('goes with the column it was in', () => {
    expect(movedColumn(MODEL, 0, 1, at(0, 0)).focus).toEqual(at(0, 1))
    expect(movedColumn(MODEL, 2, -1, at(1, 2)).focus).toEqual(at(1, 1))
  })

  test('stays put when another column moved', () => {
    expect(movedColumn(MODEL, 0, 1, at(0, 2)).focus).toEqual(at(0, 2))
  })

  test('goes with the row it was in', () => {
    expect(movedRow(MODEL, 0, 1, at(0, 1)).focus).toEqual(at(1, 1))
  })

  test('stays put when another row moved', () => {
    expect(movedRow(MODEL, 0, 1, at(-1, 1)).focus).toEqual(at(-1, 1))
  })

  test('is left alone when the move would leave the table', () => {
    const edit = movedRow(MODEL, 0, -1, at(0, 0))
    expect(edit.next).toBe(MODEL)
    expect(edit.focus).toEqual(at(0, 0))
  })
})

describe('the caret after something is added', () => {
  test('goes into the new column, in the header where its name goes', () => {
    const edit = insertedColumn(MODEL, 0)
    expect(edit.next.header).toEqual(['a', '', 'b', 'c'])
    expect(edit.focus).toEqual(at(-1, 1))
  })

  test('goes into the new row', () => {
    const edit = insertedRow(MODEL, 0)
    expect(edit.next.rows[1]).toEqual(['', '', ''])
    expect(edit.focus).toEqual(at(1, 0))
  })

  test('goes into the column the caller asked for', () => {
    expect(insertedRow(MODEL, 1, 2).focus).toEqual(at(2, 2))
  })

  test('starts the first row of a table that had none', () => {
    const empty = parseTable('| a | b |\n| - | - |')!
    const edit = insertedRow(empty, -1, 1)
    expect(edit.next.rows).toEqual([['', '']])
    expect(edit.focus).toEqual(at(0, 1))
  })
})

describe('aligning a column', () => {
  test('leaves the caret exactly where it was, offset and all', () => {
    expect(alignedColumn(MODEL, 0, 'right', at(1, 0, 2)).focus).toEqual(at(1, 0, 2))
  })

  test('turns an alignment off when it is already on', () => {
    expect(alignedColumn(MODEL, 1, 'center', undefined).next.align[1]).toBeNull()
    expect(alignedColumn(MODEL, 1, 'left', undefined).next.align[1]).toBe('left')
  })
})
