import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parseTable } from './model'
import {
  cellAbove,
  cellAfter,
  cellBefore,
  cellBelow,
  lastCell,
  lineBeside,
  renderedTables,
  tableAt,
  tableCrossed,
} from './navigation'
import { parsed } from '../../test/parsed'

const TABLE = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')

function state(marked: string): EditorState {
  const caret = marked.indexOf('|')
  return parsed(
    EditorState.create({
      doc: marked.slice(0, caret) + marked.slice(caret + 1),
      selection: EditorSelection.cursor(caret),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )
}

describe('finding tables', () => {
  const doc = `|above\n\n${TABLE}\n\nbelow`
  const span = { from: 7, to: 7 + TABLE.length }

  test.each([
    [state(doc), [span]],
    [state(`above\n\n${TABLE.slice(0, 3)}|${TABLE.slice(3)}\n\nbelow`), []],
  ])('%j', (input, wanted) => expect(renderedTables(input)).toEqual(wanted))

  test.each([
    [state(doc), span, 5, span.to + 2],
    [state(doc), span, span.to + 2, 5],
    [state(doc), span, span.to + 1, span.to],
    [state(doc), span, span.from - 1, span.from],
  ])('%j', (input, wanted, extra, last) => expect(tableCrossed(input, extra, last)).toEqual(wanted))

  test('a move beside the table does not', () => {
    expect(tableCrossed(state(doc), 0, 5)).toBeNull()
    expect(tableCrossed(state(doc), span.to + 1, span.to + 3)).toBeNull()
  })

  test('a move inside a revealed table does not', () => {
    const revealed = state(`above\n\n${TABLE.slice(0, 3)}|${TABLE.slice(3)}\n\nbelow`)
    expect(tableCrossed(revealed, span.to, span.to + 1)).toBeNull()
  })

  test('the table at a position', () => {
    expect(tableAt(state(doc), span.from + 2)).toEqual(span)
    expect(tableAt(state(doc), 2)).toBeNull()
  })
})

describe('the line beside a table', () => {
  test('is the line already there', () => {
    const doc = `|above\n\n${TABLE}\n\nbelow`
    const span = { from: 7, to: 7 + TABLE.length }
    expect(lineBeside(state(doc), span, 'above')).toEqual({
      from: 6,
      to: 6,
      made: false,
      changes: [],
    })
    expect(lineBeside(state(doc), span, 'below')).toEqual({
      from: span.to + 1,
      to: span.to + 1,
      made: false,
      changes: [],
    })
  })

  test('is made when the table ends the document', () => {
    const span = { from: 7, to: 7 + TABLE.length }
    expect(lineBeside(state(`|above\n\n${TABLE}`), span, 'below')).toEqual({
      from: span.to + 1,
      to: span.to + 1,
      made: true,
      changes: { from: span.to, insert: '\n' },
    })
  })

  test('is made when the table starts the document', () => {
    const span = { from: 0, to: TABLE.length }
    expect(lineBeside(state(`${TABLE}\n\nbelow|`), span, 'above')).toEqual({
      from: 0,
      to: 0,
      made: true,
      changes: { from: 0, insert: '\n' },
    })
  })
})

describe('stepping between cells', () => {
  const model = parseTable(['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n'))!

  test.each([
    [model, { row: -1, column: 1 }, { row: -1, column: 0 }],
    [model, { row: 0, column: 0 }, { row: -1, column: 1 }],
    [model, 'below', { row: 1, column: 1 }],
  ])('%j', (input, wanted, extra) => expect(cellAfter(input, extra)).toEqual(wanted))

  test.each([
    [model, { row: 0, column: 0 }, { row: 0, column: 1 }],
    [model, { row: -1, column: 1 }, { row: 0, column: 0 }],
    [model, 'above', { row: -1, column: 0 }],
  ])('%j', (input, wanted, extra) => expect(cellBefore(input, extra)).toEqual(wanted))

  test('down and up keep the column', () => {
    expect(cellBelow(model, { row: -1, column: 1 })).toEqual({ row: 0, column: 1 })
    expect(cellBelow(model, { row: 1, column: 0 })).toBe('below')
    expect(cellAbove({ row: 0, column: 1 })).toEqual({ row: -1, column: 1 })
    expect(cellAbove({ row: -1, column: 1 })).toBe('above')
  })

  test.each([
    [model, { row: 1, column: 1 }],
    [
      { ...model, rows: [] },
      { row: -1, column: 1 },
    ],
  ])('%j', (input, wanted) => expect(lastCell(input)).toEqual(wanted))
})
