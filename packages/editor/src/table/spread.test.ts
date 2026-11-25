import { describe, expect, test } from 'vitest'
import { parseTable, serializeTable, type TableModel } from './model'
import { mayHoldTable, spreadOver, tabbedGrid, writtenGrid } from './spread'

const MODEL: TableModel = parseTable('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |')!
const written = (model: TableModel) => serializeTable(model).split('\n')
describe('what a clipboard holds', () => {
  test('cells copied from a sheet', () => {
    expect(tabbedGrid('p1\tp2\r\np3\tp4\r\n')).toEqual([
      ['p1', 'p2'],
      ['p3', 'p4'],
    ])
    expect(tabbedGrid('one\ttwo')).toEqual([['one', 'two']])
    expect(tabbedGrid('a\t\tc\nd')).toEqual([['a', '', 'c'], ['d']])
  })
  test('plain words are no grid', () => {
    expect(tabbedGrid('plain words')).toBeNull()
    expect(tabbedGrid('two\nlines')).toBeNull()
    expect(writtenGrid('some words')).toBeNull()
    expect(writtenGrid('| a |\n|---|\n\nand prose')).toBeNull()
    expect(writtenGrid(null)).toBeNull()
  })
  test('a written table, its header as the first row', () => {
    expect(writtenGrid('| h1 | h2 |\n| --- | --- |\n| h3 | h4 |\n')).toEqual([
      ['h1', 'h2'],
      ['h3', 'h4'],
    ])
  })
  test('a written table with an empty header gives only its rows', () => {
    expect(writtenGrid('|  |  |\n| --- | --- |\n| h3 | h4 |')).toEqual([['h3', 'h4']])
  })
  test('a clipboard that may hold a table is looked into', () => {
    expect(mayHoldTable('<table><tr><td>x</td></tr></table>', 'x')).toBe(true)
    expect(mayHoldTable('', '| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
    expect(mayHoldTable('<b>x</b>', 'x')).toBe(false)
  })
})
describe('a grid pasted into a cell', () => {
  const grid = [
    ['p1', 'p2'],
    ['p3', 'p4'],
  ]
  test('fills the cells from there on', () => {
    const edit = spreadOver(MODEL, { row: 0, column: 0 }, grid)
    expect(written(edit.next)).toEqual(['| a   | b   |', '| --- | --- |', '| p1  | p2  |', '| p3  | p4  |'])
    expect(edit.focus).toEqual({ at: { row: 1, column: 1 }, offset: 2 })
  })
  test('grows rows and columns it needs', () => {
    const edit = spreadOver(MODEL, { row: 1, column: 1 }, grid)
    expect(written(edit.next)).toEqual([
      '| a   | b   |     |',
      '| --- | --- | --- |',
      '| 1   | 2   |     |',
      '| 3   | p1  | p2  |',
      '|     | p3  | p4  |',
    ])
  })
  test('starts in the header when pasted there', () => {
    const edit = spreadOver(MODEL, { row: -1, column: 1 }, [['x'], ['y']])
    expect(written(edit.next)).toEqual(['| a   | x   |', '| --- | --- |', '| 1   | y   |', '| 3   | 4   |'])
  })
  test('never writes a tab, a line break or a bare pipe into a cell', () => {
    const edit = spreadOver(MODEL, { row: 0, column: 0 }, [['a|b', 'two\nlines']])
    expect(written(edit.next)[2]).toBe('| a\\|b | two lines |')
  })
})
