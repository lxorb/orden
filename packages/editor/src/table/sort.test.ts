// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor } from '../editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function hover(view: EditorView) {
  const th = view.dom.querySelector('th')
  if (!th) throw new Error('the table drew no header')
  const over = new MouseEvent('pointerover', { bubbles: true })
  Object.defineProperty(over, 'pointerType', { value: 'mouse' })
  th.dispatchEvent(over)
}

function press(view: EditorView, said: string) {
  hover(view)
  const found = view.dom.querySelector<HTMLElement>(`button[title="${said}"]`)
  if (!found) throw new Error(`the table has no ${said} button`)
  found.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

function column(view: EditorView): string[] {
  return view.state.doc
    .toString()
    .split('\n')
    .slice(2, 5)
    .map((row) => row.split('|')[1]?.trim() ?? '')
}

test('sorting a column that is already in order puts it the other way round', () => {
  const doc = '| a |\n| --- |\n| 1 |\n| 2 |\n| 3 |\n\nend'
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)

  press(view, 'Sort by this column')
  expect(column(view)).toEqual(['3', '2', '1'])
  press(view, 'Sort by this column')
  expect(column(view)).toEqual(['1', '2', '3'])
})
