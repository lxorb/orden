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
