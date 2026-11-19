// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { blockIds } from '@orden/markdown/links'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  HTMLTableCellElement.prototype.focus = function (this: HTMLTableCellElement, options) {
    this.tabIndex = 0
    HTMLElement.prototype.focus.call(this, options)
  }
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const NOTE = '| a | b |\n| --- | --- |\n| 1 | 2 | ^t1\n| 3 | 4 |\n\nend'

function drawn(): EditorView {
  const view = createEditor({
    parent: document.body,
    doc: NOTE,
    selection: { anchor: NOTE.length },
  })
  open.push(view)
  forceParsing(view, NOTE.length, 10_000)
  return view
}

describe('a table row named by a block id at its end', () => {
  test('draws only the columns the table has', () => {
    const view = drawn()
    const cells = [...view.dom.querySelectorAll('td')].map((cell) => cell.textContent)
    expect(view.dom.querySelectorAll('th').length).toBe(2)
    expect(cells).toEqual(['1', '2', '3', '4'])
  })

  test('keeps its name after a cell of the table is typed in', () => {
    const view = drawn()
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '3')
    if (!cell) throw new Error('the table drew no cell holding 3')
    cell.focus()
    cell.textContent = '33'
    cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const text = view.state.doc.toString()
    expect(text).toContain('33')
    expect(blockIds(text).map((one) => one.id)).toEqual(['t1'])
  })
})
