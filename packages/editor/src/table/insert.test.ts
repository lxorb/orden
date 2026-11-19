// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import { afterEach, beforeAll, expect, test } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createEditor } from '../editor'
import { insertTableToEdit } from './keymap'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
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
test('a table asked for inside a table is refused, and the table there is left as it was', () => {
  const inside = TABLE.indexOf('| 1') + 2
  const view = createEditor({ parent: document.body, doc: TABLE, selection: { anchor: inside } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  expect(insertTableToEdit(view)).toBe(false)
  expect(view.state.doc.toString()).toBe(TABLE)
  expect(document.activeElement?.tagName).not.toBe('TH')
})
