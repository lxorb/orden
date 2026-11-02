// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { createEditor } from '../editor'

/** A cell being typed in when its table leaves the document. Chromium sends the blur
 *  while the editor is still taking the cell out of the page, as jsdom does not;
 *  emulated here, the way the image alt field's test does. */

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const errors: unknown[] = []
const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  window.addEventListener('error', (event) => errors.push(event.error))
  Node.prototype.removeChild = <T extends Node>(child: T): T => {
    const focused = document.activeElement
    if (focused && child.contains(focused)) focused.dispatchEvent(new FocusEvent('blur'))
    ;(child as Node as ChildNode).remove()
    return child
  }
})

afterEach(() => {
  errors.length = 0
  for (const view of open.splice(0)) view.destroy()
})

function typedCell(): EditorView {
  const view = createEditor({
    parent: document.body,
    doc: TABLE,
    selection: { anchor: TABLE.length },
  })
  open.push(view)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
    (one) => one.textContent === '1',
  )
  if (!cell) throw new Error('the table drew no cell holding 1')
  // jsdom focuses nothing for being contenteditable alone.
  cell.tabIndex = 0
  cell.focus()
  cell.textContent = '1x'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
  return view
}

test('a table taken away with a cell mid-edit throws nothing and writes nothing', () => {
  const view = typedCell()
  const asked = vi.spyOn(view, 'posAtDOM')
  view.dispatch({ changes: { from: TABLE.indexOf('|'), to: TABLE.indexOf('\n\nend'), insert: '' } })
  // The widget is destroyed before its DOM comes out, which drops the edit, so the
  // blur has nothing to write and never asks a view in mid-update where the table is.
  expect(asked).not.toHaveBeenCalled()
  expect(errors).toEqual([])
  expect(view.state.doc.toString()).toBe('words\n\n\n\nend')
})

test('a table replaced by other words with a cell mid-edit keeps those words', () => {
  const view = typedCell()
  const asked = vi.spyOn(view, 'posAtDOM')
  view.dispatch({
    changes: { from: TABLE.indexOf('|'), to: TABLE.indexOf('\n\nend'), insert: 'prose' },
  })
  expect(asked).not.toHaveBeenCalled()
  expect(errors).toEqual([])
  expect(view.state.doc.toString()).toBe('words\n\nprose\n\nend')
})

test('a table redrawn by a change to its own text with a cell mid-edit keeps that change', () => {
  const view = typedCell()
  const asked = vi.spyOn(view, 'posAtDOM')
  const two = TABLE.indexOf('2')
  view.dispatch({ changes: { from: two, to: two + 1, insert: '3' } })
  expect(asked).not.toHaveBeenCalled()
  expect(errors).toEqual([])
  expect(view.state.doc.toString()).toBe(TABLE.replace('2', '3'))
})
