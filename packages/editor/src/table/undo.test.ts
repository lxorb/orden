// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { SharedDoc } from '../shared'

/** Undo and redo pressed inside a cell, in a real view: the cell's edits are
 *  the note's, so they come back out the way the note's own do.
 *
 *  jsdom lays nothing out, so a range has no rectangles to measure. */

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
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

/** The cell holding `1`, with `XYZ` typed after it and not yet written out. */
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
