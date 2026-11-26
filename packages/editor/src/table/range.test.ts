import { describe, expect, test } from 'vitest'
import { parseTable, serializeTable } from './model'
import {
  clamped,
  columnRange,
  coversTable,
  extended,
  filled,
  gridHtml,
  gridIn,
  gridText,
  inRect,
  rectOf,
  rowRange,
  wholeTable,
} from './range'

const MODEL = parseTable('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | x\\|y | 6 |')!
const at = (row: number, column: number) => ({ row, column })
describe('a range of cells', () => {
  test('is the rectangle between its two corners, whichever way it was drawn', () => {
    const rect = { top: -1, bottom: 1, left: 0, right: 1 }
    expect(rectOf({ anchor: at(1, 1), head: at(-1, 0) })).toEqual(rect)
    expect(rectOf({ anchor: at(-1, 0), head: at(1, 1) })).toEqual(rect)
    expect(inRect(rect, at(0, 1))).toBe(true)
    expect(inRect(rect, at(0, 2))).toBe(false)
  })
  test('of a row, a column and the whole table', () => {
    expect(rectOf(rowRange(MODEL, 1))).toEqual({ top: 1, bottom: 1, left: 0, right: 2 })
    expect(rectOf(columnRange(MODEL, 2))).toEqual({ top: -1, bottom: 1, left: 2, right: 2 })
    expect(coversTable(MODEL, wholeTable(MODEL))).toBe(true)
    expect(coversTable(MODEL, rowRange(MODEL, 0))).toBe(false)
  })
  test('grows a cell at a time and stops at the table’s edges', () => {
    const one = { anchor: at(0, 0), head: at(0, 0) }
    expect(extended(MODEL, one, 'right').head).toEqual(at(0, 1))
    expect(extended(MODEL, one, 'down').head).toEqual(at(1, 0))
    expect(extended(MODEL, one, 'up').head).toEqual(at(-1, 0))
    expect(extended(MODEL, one, 'left').head).toEqual(at(0, 0))
    expect(extended(MODEL, { anchor: at(0, 0), head: at(1, 2) }, 'down').head).toEqual(at(1, 2))
  })
  test('is pulled back inside a table that shrank', () => {
    expect(clamped(MODEL, { anchor: at(0, 0), head: at(9, 9) })).toEqual({ anchor: at(0, 0), head: at(1, 2) })
  })
})
describe('what a range holds', () => {
  const rect = { top: 0, bottom: 1, left: 1, right: 2 }
  test('is copied as a grid, a pipe written as a pipe', () => {
    expect(gridIn(MODEL, rect)).toEqual([
      ['2', '3'],
      ['x\\|y', '6'],
    ])
    expect(gridText(gridIn(MODEL, rect))).toBe('2\t3\nx|y\t6')
    expect(gridHtml([['<b>', 'a&b']])).toBe('<table><tr><td>&lt;b&gt;</td><td>a&amp;b</td></tr></table>')
  })
  test('is emptied or filled without touching the rest', () => {
    expect(
      serializeTable(filled(MODEL, rect, ''))
        .split('\n')
        .slice(2),
    ).toEqual(['| 1   |     |     |', '| 4   |     |     |'])
    expect(filled(MODEL, { top: 0, bottom: 0, left: 0, right: 0 }, '1')).toBe(MODEL)
    expect(filled(MODEL, { top: -1, bottom: -1, left: 0, right: 1 }, 'h').header).toEqual(['h', 'h', 'c'])
  })
})
