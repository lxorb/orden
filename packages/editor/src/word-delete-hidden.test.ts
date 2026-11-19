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
function wordKey(doc: string, at: number, key: 'Backspace' | 'Delete'): string {
  const view = viewAt(doc, at)
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor')
  return view.state.doc.toString()
}
describe('Ctrl+Backspace one space after a drawn mark that hides its closing', () => {
  test('does not take the hidden bracket of a footnote mark', () => {
    const doc = 'see[^1] z'
    expect(wordKey(doc, doc.indexOf('z'), 'Backspace')).not.toContain('[^1z')
  })
  test('does not take the hidden closing tag of underlined words', () => {
    const doc = 'a <u>under</u> z'
    expect(wordKey(doc, doc.indexOf('z'), 'Backspace')).not.toContain('<u>underz')
  })
  test('does not take the hidden angle bracket of an autolink', () => {
    const doc = 'a <https://x.com> z'
    expect(wordKey(doc, doc.indexOf('z'), 'Backspace')).not.toContain('x.comz')
  })
})
describe('Ctrl+Delete one space before a drawn mark that hides its opening', () => {
  test('does not take the hidden opening of a footnote mark', () => {
    expect(wordKey('a [^1] z', 1, 'Delete')).not.toBe('a1] z')
  })
  test('does not take the hidden opening tag of underlined words', () => {
    expect(wordKey('a <u>under</u> z', 1, 'Delete')).not.toBe('aunder</u> z')
  })
})
