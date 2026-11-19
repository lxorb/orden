// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { SharedDoc } from '../shared'
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
function sharedTable(shared: SharedDoc): EditorView {
  const view = createEditor({ parent: document.body, shared, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, shared.text.length, 10_000)
  return view
}
function tableIn(shared: SharedDoc): string {
  const text = shared.text.toString()
  return text.slice(text.indexOf('|'), text.indexOf('\n\nend'))
}
test('typed words stay in their row when another pane writes the whole table with the next cell', async () => {
  const shared = new SharedDoc(TABLE)
  const view = sharedTable(shared)
  typed(cellAt(view, 0, 0), 'Ann')
  const text = shared.text.toString()
  const from = text.indexOf('| C')
  const table = tableIn(shared)
  shared.edit([
    {
      from,
      to: from + table.length,
      insert: table.replace('| Ann      |          |', '| Ann      | x        |'),
    },
  ])
  await Promise.resolve()
  expect(cellAt(view, 0, 0).textContent).toBe('Ann')
  expect(document.activeElement).toBe(cellAt(view, 0, 0))
  expect(cellAt(view, 1, 0).textContent).toBe('')
  expect(tableIn(shared).split('\n')[2]).toBe('| Ann      | x        |')
})
test('typed words stay when another pane renames a column', () => {
  const shared = new SharedDoc(TABLE)
  const view = sharedTable(shared)
  typed(cellAt(view, 0, 0), 'Ann')
  const text = shared.text.toString()
  const from = text.indexOf('| C')
  const table = tableIn(shared)
  shared.edit([{ from, to: from + table.length, insert: table.replace('Column 1', 'Name    ') }])
  flushTableEdits()
  expect(tableIn(shared).split('\n')[0]).toContain('Name')
  expect(tableIn(shared).split('\n')[2]).toContain('Ann')
})
test('typed words stay when a sync changes the note around the table and another cell at once', () => {
  const shared = new SharedDoc(TABLE)
  const view = sharedTable(shared)
  typed(cellAt(view, 1, 1), 'Bob')
  const now = shared.text.toString()
  shared.replace(now.replace('intro', 'i').replace('| Column 2 |', '| Column 9 |').replace('end', 'end!'))
  flushTableEdits()
  expect(shared.text.toString()).toContain('Bob')
  expect(shared.text.toString()).toContain('Column 9')
})
test('a table under the caret stays drawn while a cell is typed in', () => {
  const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
  const view = createEditor({ parent: document.body, doc, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, doc.length, 10_000)
  typed(cellAt(view, 0, 0), '1x')
  expect(view.dom.querySelectorAll('table')).toHaveLength(1)
  expect(document.activeElement).toBe(cellAt(view, 0, 0))
  typed(cellAt(view, 0, 0), '1xy')
  expect(view.state.doc.toString()).toContain('| 1xy |')
})
test('the caret follows its whole row, not another row that shares the cell', async () => {
  const shared = new SharedDoc('words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend')
  const view = sharedTable(shared)
  typed(cellAt(view, 0, 0), '1x')
  const at = shared.text.toString().indexOf('| 1x')
  shared.edit([{ from: at, to: at, insert: '| 1x | 9 |\n' }])
  await Promise.resolve()
  const focused = document.activeElement as HTMLElement
  typed(focused, '1xy')
  const rows = shared.text.toString().split('\n').slice(4, 6)
  expect(rows.map((row) => row.split('|').map((cell) => cell.trim()))).toEqual([
    ['', '1x', '9', ''],
    ['', '1xy', '2', ''],
  ])
})
