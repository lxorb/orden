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
describe('Ctrl+Backspace one space after a marked word', () => {
  test('deletes the bold word, not its hidden closing stars', () => {
    const doc = 'a **bold** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).not.toContain('**bold')
    expect(view.state.doc.toString()).toMatch(/^a +z$/)
  })
  test('deletes the link, not the hidden bracket of its address', () => {
    const doc = 'see [docs](https://x.com) now'
    const view = viewAt(doc, doc.indexOf('now'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).not.toContain('https://x.comnow')
  })
  test('deletes the wikilink words, not its hidden closing brackets', () => {
    const doc = 'a [[Note]] z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).not.toContain('[[Notez')
  })
})
describe('Ctrl+Delete one space before a marked word', () => {
  test('deletes the bold word, not its hidden opening stars', () => {
    const doc = 'a **bold** z'
    const view = viewAt(doc, 1)
    wordKey(view, 'Delete')
    expect(view.state.doc.toString()).not.toContain('bold**')
  })
})
