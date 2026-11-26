// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { selectIn } from './caret'
import { editableCellAt, pasteIntoCell } from './widget'
import { flushTableEdits } from './widget'
import { noRects } from '../../test/views'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const open: EditorView[] = []
beforeAll(() => {
  noRects()
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
})
function paste(cell: HTMLElement, held: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => held[kind] ?? '' } })
  cell.dispatchEvent(event)
}
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
test('text pasted from the menu over a table cell lands in that cell, not at the note’s caret', () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 2 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  expect(editableCellAt(view, cell)).toBe(cell)
  expect(editableCellAt(view, view.contentDOM)).toBeNull()
  cell.tabIndex = 0
  cell.focus()
  selectIn(cell, 1)
  pasteIntoCell(cell, 'pasted')
  flushTableEdits()
  expect(view.state.doc.toString()).toContain('| 1pasted | 2   |')
  expect(view.state.doc.toString()).toMatch(/^words\n\n\|/)
})
test('cells pasted into a table cell spread over the cells from there on', async () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 2 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.tabIndex = 0
  cell.focus()
  paste(cell, { 'text/plain': 'p1\tp2\np3\tp4' })
  await expect.poll(() => view.state.doc.toString()).toContain('p4')
  expect(view.state.doc.toString()).toBe('words\n\n| a   | b   |\n| --- | --- |\n| p1  | p2  |\n| p3  | p4  |\n\nend')
})
test('a web table pasted into a table cell spreads the same way', async () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 2 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '2')
  if (!cell) throw new Error('the table drew no cell holding 2')
  cell.tabIndex = 0
  cell.focus()
  paste(cell, {
    'text/html': '<table><tr><td>h1</td><td><a href="https://example.com">h2</a></td></tr></table>',
    'text/plain': 'h1 h2',
  })
  await expect.poll(() => view.state.doc.toString()).toContain('| 1   | h1  | [h2](https://example.com) |')
  expect(view.state.doc.toString()).not.toContain('\t')
})
