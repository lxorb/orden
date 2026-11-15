// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { flushTableEdits } from './view'

const TABLE = 'intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|     |     |\n|     |     |\n\nend'
const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  HTMLTableCellElement.prototype.focus = function (this: HTMLTableCellElement, options) {
    this.tabIndex = 0
    HTMLElement.prototype.focus.call(this, options)
  }
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function cellAt(view: EditorView, row: number, column: number): HTMLElement {
  const cell = view.dom.querySelector<HTMLElement>(`td[data-row="${row}"][data-column="${column}"]`)
  if (!cell) throw new Error(`the table drew no cell at ${row}, ${column}`)
  return cell
}

function typed(cell: HTMLElement, text: string) {
  cell.focus()
  cell.textContent = text
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

test('a written cell is not copied into a row that held the same words', () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)

  typed(cellAt(view, 0, 0), 'Ann')
  flushTableEdits()

  expect(cellAt(view, 0, 0).textContent).toBe('Ann')
  expect(cellAt(view, 1, 0).textContent).toBe('')

  typed(cellAt(view, 0, 0), 'Anna')
  flushTableEdits()

  const rows = view.state.doc.toString().split('\n').slice(4, 6)
  expect(rows.map((row) => row.split('|')[1]?.trim())).toEqual(['Anna', ''])
})

test('typed words stay in their row when another cell of that row is written meanwhile', () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)

  typed(cellAt(view, 0, 0), 'Ann')
  const row = view.state.doc.line(5)
  view.dispatch({ changes: { from: row.to - 2, insert: 'x' } })

  expect(cellAt(view, 0, 0).textContent).toBe('Ann')
  expect(cellAt(view, 1, 0).textContent).toBe('')
  flushTableEdits()

  const rows = view.state.doc.toString().split('\n').slice(4, 6)
  expect(rows.map((one) => one.split('|').map((cell) => cell.trim()))).toEqual([
    ['', 'Ann', 'x', ''],
    ['', '', '', ''],
  ])
})

test('a cell written after a pause is kept on the page, not drawn again', () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)

  const cell = cellAt(view, 0, 0)
  typed(cell, 'hello')
  flushTableEdits()

  expect(cellAt(view, 0, 0)).toBe(cell)
  expect(view.state.doc.toString()).toContain('| hello')
})
