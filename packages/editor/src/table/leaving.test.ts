// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { createEditor } from '../editor'

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
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
    (one) => one.textContent === '1',
  )
  if (!cell) throw new Error('the table drew no cell holding 1')
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
