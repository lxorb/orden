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
function viewAt(doc: string, at: number, quiet = false) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: at } })
  open.push(view)
  if (quiet) setQuietMarks(view, true)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}
function wordKey(view: EditorView, key: 'Backspace' | 'Delete') {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor')
}
describe('Ctrl+Backspace right after punctuation that follows marked words', () => {
  test('takes the colon after a bold label, not the hidden closing stars', () => {
    const doc = '**Note**: text'
    const view = viewAt(doc, '**Note**:'.length)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('**Note** text')
  })
  test('takes the full stop after a wikilink, not its hidden brackets', () => {
    const doc = 'See [[Plans]]. Next'
    const view = viewAt(doc, 'See [[Plans]].'.length)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('See [[Plans]] Next')
  })
  test('takes the comma after an italic word, not its hidden star', () => {
    const doc = 'see *this*, then'
    const view = viewAt(doc, 'see *this*,'.length)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('see *this* then')
  })
  test('takes the full stop after a picture, not the whole picture', () => {
    const doc = '![a](x.png). More'
    const view = viewAt(doc, '![a](x.png).'.length)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('![a](x.png) More')
  })
  test('takes the colon after inline code, not its hidden backtick', () => {
    const doc = 'run `ls`: list'
    const view = viewAt(doc, 'run `ls`:'.length)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('run `ls` list')
  })
})
describe('Ctrl+Delete right before punctuation that leads marked words', () => {
  test('takes the opening bracket before a bold word, not the hidden opening stars', () => {
    const doc = 'x (**bold**) y'
    const view = viewAt(doc, 'x '.length)
    wordKey(view, 'Delete')
    expect(view.state.doc.toString()).toBe('x **bold**) y')
  })
})
describe('with marks out of sight, word delete at the edge of a marked word beside another', () => {
  test('Ctrl+Backspace at the start of an italic word after a bold word takes the bold word', () => {
    const doc = '**bold** *it*'
    const view = viewAt(doc, '**bold** *'.length, true)
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('*it*')
  })
  test('Ctrl+Delete at the end of an italic word before a bold word takes the bold word', () => {
    const doc = '*it* **bold**'
    const view = viewAt(doc, '*it'.length, true)
    wordKey(view, 'Delete')
    expect(view.state.doc.toString()).toBe('*it*')
  })
})
