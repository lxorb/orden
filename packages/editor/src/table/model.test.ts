import { describe, expect, test } from 'vitest'
import {
  displayWidth,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  removeColumn,
  removeRow,
  serializeTable,
  setAlign,
  setCell,
} from './model'

const SOURCE = ['| Name | Size |', '| :--- | ---: |', '| a    | 1    |', '| b    | 2    |'].join(
  '\n',
)

describe('parsing', () => {
  test('reads header, alignment and rows', () => {
    expect(parseTable(SOURCE)).toEqual({
      header: ['Name', 'Size'],
      align: ['left', 'right'],
      rows: [
        ['a', '1'],
        ['b', '2'],
      ],
    })
  })

  test('reads centre alignment', () => {
    expect(parseTable('| a |\n| :-: |\n| 1 |')?.align).toEqual(['center'])
  })

  test('reads absent alignment as null', () => {
    expect(parseTable('| a |\n| --- |\n| 1 |')?.align).toEqual([null])
  })

  test('pads ragged rows to a rectangle', () => {
    expect(parseTable('| a | b |\n| - | - |\n| 1 |')?.rows).toEqual([['1', '']])
  })

  test('keeps escaped pipes inside a cell', () => {
    expect(parseTable('| a\\|b |\n| - |\n| 1 |')?.header).toEqual(['a\\|b'])
  })

  test('keeps an escaped pipe that ends a row', () => {
    // A row need not be closed with a pipe, so the last one on the line is
    // either the closing pipe or part of a cell - and a `\|` is the cell's.
    expect(parseTable('| a | b\\|\n| - | - |\n| 1 | 2 |')?.header).toEqual(['a', 'b\\|'])
    expect(parseTable('| a | b |\n| - | - |\n| 1 | 2\\|')?.rows).toEqual([['1', '2\\|']])
  })

  test('reads a closing pipe as the end of the row, not another cell', () => {
    expect(parseTable('| a | b |\n| - | - |\n| 1 | 2 |')?.header).toEqual(['a', 'b'])
    expect(parseTable('a | b\n- | -\n1 | 2')?.header).toEqual(['a', 'b'])
  })

  test('keeps an empty last cell', () => {
    expect(parseTable('| a | b |\n| - | - |\n| 1 |  |')?.rows).toEqual([['1', '']])
  })

  test('rejects text that is not a table', () => {
    expect(parseTable('just a paragraph')).toBeNull()
    expect(parseTable('| a |\nnot a delimiter\n| 1 |')).toBeNull()
  })
})

describe('serializing', () => {
  test('round-trips without changing meaning', () => {
    const model = parseTable(SOURCE)!
    expect(parseTable(serializeTable(model))).toEqual(model)
  })

  test('aligns pipes to the widest cell', () => {
    expect(serializeTable(parseTable('|a|bb|\n|-|-|\n|cccc|d|')!)).toBe(
      ['| a    | bb  |', '| ---- | --- |', '| cccc | d   |'].join('\n'),
    )
  })

  test('writes alignment markers back', () => {
    const model = setAlign(parseTable('| a |\n| - |\n| 1 |')!, 0, 'center')
    expect(serializeTable(model).split('\n')[1]).toBe('| :-: |')
  })
})

describe('editing', () => {
  const model = parseTable(SOURCE)!

  test('sets a body cell', () => {
    expect(setCell(model, 0, 1, '9').rows[0]).toEqual(['a', '9'])
  })

  test('sets a header cell with row -1', () => {
    expect(setCell(model, -1, 0, 'Label').header).toEqual(['Label', 'Size'])
  })

  test('escapes a pipe typed into a cell', () => {
    expect(setCell(model, 0, 0, 'x|y').rows[0]?.[0]).toBe('x\\|y')
  })

  test('does not escape a pipe that is escaped already', () => {
    // A focused cell shows its markdown, so the value comes back with the
    // backslash in it. Escaping again added one per visit to the cell.
    expect(setCell(model, 0, 0, 'x\\|y').rows[0]?.[0]).toBe('x\\|y')
    const twice = setCell(setCell(model, 0, 0, 'x|y'), 0, 0, 'x\\|y')
    expect(twice.rows[0]?.[0]).toBe('x\\|y')
  })

  test('flattens a newline typed into a cell', () => {
    expect(setCell(model, 0, 0, 'x\ny').rows[0]?.[0]).toBe('x y')
  })

  test('inserts and removes columns', () => {
    expect(insertColumn(model, 1).header).toEqual(['Name', '', 'Size'])
    expect(removeColumn(model, 0).header).toEqual(['Size'])
  })

  test('refuses to remove the last column', () => {
    const single = parseTable('| a |\n| - |\n| 1 |')!
    expect(removeColumn(single, 0)).toEqual(single)
  })

  test('refuses an index that is not a row or a column', () => {
    // `splice` reads a negative index from the end, so -1 used to mean "the
    // last one" - and -1 is what the column bar holds while it is hidden.
    expect(removeColumn(model, -1)).toEqual(model)
    expect(removeColumn(model, 2)).toEqual(model)
    expect(removeRow(model, -1)).toEqual(model)
    expect(removeRow(model, 2)).toEqual(model)
    expect(moveColumn(model, -1, 0)).toEqual(model)
    expect(moveRow(model, -1, 0)).toEqual(model)
  })

  test('inserts and removes rows', () => {
    expect(insertRow(model, 1).rows).toEqual([
      ['a', '1'],
      ['', ''],
      ['b', '2'],
    ])
    expect(removeRow(model, 0).rows).toEqual([['b', '2']])
  })

  test('reorders rows', () => {
    expect(moveRow(model, 0, 1).rows).toEqual([
      ['b', '2'],
      ['a', '1'],
    ])
  })

  test('ignores a row move that leaves the table', () => {
    expect(moveRow(model, 0, -1)).toEqual(model)
  })

  test('reorders columns with their alignment', () => {
    const moved = moveColumn(model, 0, 1)
    expect(moved.header).toEqual(['Size', 'Name'])
    expect(moved.align).toEqual(['right', 'left'])
  })
})

describe('display width', () => {
  test('counts CJK as two columns', () => {
    expect(displayWidth('ab')).toBe(2)
    expect(displayWidth('日本')).toBe(4)
  })

  test('aligns a CJK table', () => {
    const source = serializeTable(parseTable('| 名前 | x |\n| - | - |\n| ab | y |')!)
    const [header = '', , body = ''] = source.split('\n')
    expect(displayWidth(header)).toBe(displayWidth(body))
  })
})
