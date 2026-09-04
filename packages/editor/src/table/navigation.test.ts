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

const TABLE = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')

/** A document with `|` marking the caret. */
function state(marked: string): EditorState {
  const caret = marked.indexOf('|')
  return EditorState.create({
    doc: marked.slice(0, caret) + marked.slice(caret + 1),
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage })],
  })
}

describe('finding tables', () => {
  // The caret marker is also the table's own character, so the caret goes
  // first, where no pipe can be.
  const doc = `|above\n\n${TABLE}\n\nbelow`
  const span = { from: 7, to: 7 + TABLE.length }

  test('a table is rendered while the caret is elsewhere', () => {
    expect(renderedTables(state(doc))).toEqual([span])
  })

  test('a table is not rendered while the caret is in its text', () => {
    expect(renderedTables(state(`above\n\n${TABLE.slice(0, 3)}|${TABLE.slice(3)}\n\nbelow`))).toEqual([])
  })

  test('a move that skips over the table crosses it', () => {
    expect(tableCrossed(state(doc), 5, span.to + 2)).toEqual(span)
    expect(tableCrossed(state(doc), span.to + 2, 5)).toEqual(span)
  })

  test('a move that stops at the edge of the table crosses it', () => {
    expect(tableCrossed(state(doc), span.to + 1, span.to)).toEqual(span)
    expect(tableCrossed(state(doc), span.from - 1, span.from)).toEqual(span)
  })

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
    expect(lineBeside(state(doc), span, 'above')).toEqual({ from: 6, to: 6 })
    expect(lineBeside(state(doc), span, 'below')).toEqual({ from: span.to + 1, to: span.to + 1 })
  })

  test('is made when the table ends the document', () => {
    const span = { from: 7, to: 7 + TABLE.length }
    expect(lineBeside(state(`|above\n\n${TABLE}`), span, 'below')).toEqual({
      from: span.to + 1,
      to: span.to + 1,
      changes: { from: span.to, insert: '\n' },
    })
  })

  test('is made when the table starts the document', () => {
    const span = { from: 0, to: TABLE.length }
    expect(lineBeside(state(`${TABLE}\n\nbelow|`), span, 'above')).toEqual({
      from: 0,
      to: 0,
      changes: { from: 0, insert: '\n' },
    })
  })
})

describe('stepping between cells', () => {
  const model = parseTable(['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n'))!

  test('forward runs along the row, then on to the next', () => {
    expect(cellAfter(model, { row: -1, column: 0 })).toEqual({ row: -1, column: 1 })
    expect(cellAfter(model, { row: -1, column: 1 })).toEqual({ row: 0, column: 0 })
    expect(cellAfter(model, { row: 1, column: 1 })).toBe('below')
  })

  test('backward runs the same way in reverse', () => {
    expect(cellBefore(model, { row: 0, column: 1 })).toEqual({ row: 0, column: 0 })
    expect(cellBefore(model, { row: 0, column: 0 })).toEqual({ row: -1, column: 1 })
    expect(cellBefore(model, { row: -1, column: 0 })).toBe('above')
  })

  test('down and up keep the column', () => {
    expect(cellBelow(model, { row: -1, column: 1 })).toEqual({ row: 0, column: 1 })
    expect(cellBelow(model, { row: 1, column: 0 })).toBe('below')
    expect(cellAbove({ row: 0, column: 1 })).toEqual({ row: -1, column: 1 })
    expect(cellAbove({ row: -1, column: 1 })).toBe('above')
  })

  test('the last cell of a table without rows is in the header', () => {
    expect(lastCell(model)).toEqual({ row: 1, column: 1 })
    expect(lastCell({ ...model, rows: [] })).toEqual({ row: -1, column: 1 })
  })
})
