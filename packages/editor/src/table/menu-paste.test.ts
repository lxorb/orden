// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { selectIn } from './caret'
import { editableCellAt, pasteIntoCell } from './view'
import { flushTableEdits } from './widget'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

test('text pasted from the menu over a table cell lands in that cell, not at the note’s caret', () => {
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: 2 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
    (one) => one.textContent === '1',
  )
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
