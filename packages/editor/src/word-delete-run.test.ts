// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewAt(doc: string, at: number) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: at } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}
function wordKey(view: EditorView, key: 'Backspace' | 'Delete') {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor')
}
describe('Ctrl+Backspace after a marked run of several words', () => {
  test('keeps the earlier words of a bold run', () => {
    const doc = 'a **one two three** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toContain('one two')
  })
  test('keeps the earlier words of an italic run', () => {
    const doc = 'a *one two* z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toContain('one')
  })
  test('keeps the earlier words of an underlined run', () => {
    const doc = 'a <u>one two</u> z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toContain('one')
  })
})
describe('Ctrl+Delete before a marked run of several words', () => {
  test('keeps the later words of a bold run', () => {
    const doc = 'a **one two three** z'
    const view = viewAt(doc, 1)
    wordKey(view, 'Delete')
    expect(view.state.doc.toString()).toContain('two three')
  })
})
