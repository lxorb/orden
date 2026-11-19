// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'
import { setQuietMarks } from './modes'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function quietView(doc: string, at: number) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: at } })
  open.push(view)
  setQuietMarks(view, true)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}
function press(view: EditorView, key: string) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor')
}
describe('with marks out of sight, Backspace after a marked word', () => {
  test('deletes the last letter of a bold word, not its hidden stars', () => {
    const doc = 'a **bold** z'
    const view = quietView(doc, doc.indexOf(' z') + 1)
    press(view, 'Backspace')
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('a **bol**z')
  })
  test('deletes the last letter of inline code, not its hidden backtick', () => {
    const doc = 'run `make` now'
    const view = quietView(doc, doc.indexOf(' now'))
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('run `mak` now')
  })
  test('Delete before a bold word deletes its first letter, not its hidden stars', () => {
    const doc = 'a **bold** z'
    const view = quietView(doc, 2)
    press(view, 'Delete')
    expect(view.state.doc.toString()).toBe('a **old** z')
  })
  test('Backspace on the only letter of a bold word takes its hidden stars too', () => {
    const doc = 'a **b** z'
    const view = quietView(doc, doc.indexOf(' z'))
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('a  z')
  })
})
