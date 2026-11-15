// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { SharedDoc } from '../shared'

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

const TABLE = '| a |\n| --- |\n| 1 |\n\nend'

function note(on: { shared?: SharedDoc } = {}): EditorView {
  const view = createEditor({
    parent: document.body,
    doc: TABLE,
    ...on,
    selection: { anchor: TABLE.length },
  })
  open.push(view)
  return view
}

function typeInCell(view: EditorView): HTMLElement {
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
    (one) => one.textContent === '1',
  )
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.focus()
  cell.textContent = '1XYZ'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
  return cell
}

function press(cell: HTMLElement, shiftKey = false) {
  cell.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('undo in a table cell', () => {
  test('keeps a table under the caret of the note drawn, and the cell focused', async () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
    const view = createEditor({ parent: document.body, doc, selection: { anchor: 0 } })
    open.push(view)
    forceParsing(view, doc.length, 10_000)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
      (one) => one.textContent === '1',
    )
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.focus()
    for (const text of ['1x', '1xy']) {
      cell.textContent = text
      cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }

    press(cell)
    for (let round = 0; round < 3; round++) await Promise.resolve()

    expect(view.state.doc.toString()).toBe(doc)
    expect(view.dom.querySelector('table')).not.toBeNull()
    expect(document.activeElement?.tagName).toBe('TD')
  })

  test('takes back what was typed there, in a note shared between views', () => {
    const shared = new SharedDoc(TABLE)
    const view = note({ shared })
    const cell = typeInCell(view)

    press(cell)
    expect(view.state.doc.toString()).toBe(TABLE)
    expect(shared.text.toString()).toBe(TABLE)

    press(cell, true)
    expect(view.state.doc.toString()).toContain('1XYZ')
  })

  test('and in a note that is not', () => {
    const view = note()
    const cell = typeInCell(view)

    press(cell)
    expect(view.state.doc.toString()).toBe(TABLE)

    press(cell, true)
    expect(view.state.doc.toString()).toContain('1XYZ')
  })

  test('arriving as input, the way a Mac sends Cmd+Z', () => {
    const view = note({ shared: new SharedDoc(TABLE) })
    const cell = typeInCell(view)

    cell.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
    )
    expect(view.state.doc.toString()).toBe(TABLE)
  })
})
