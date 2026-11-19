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
function after(doc: string, at: number, key: string): string {
  const view = quietView(doc, at)
  press(view, key)
  return view.state.doc.toString()
}
describe('with marks out of sight, Backspace at the start of words that open with a mark', () => {
  test('does not glue a list item marker to its bold words', () => {
    const doc = 'one\n- **Note**: words'
    const got = after(doc, doc.indexOf('Note'), 'Backspace')
    expect(got).not.toContain('-**Note**')
    expect(got).toBe(after(doc, doc.indexOf('**Note'), 'Backspace'))
  })
  test('does not glue a heading marker to its code words', () => {
    const doc = 'one\n## `install` it'
    const got = after(doc, doc.indexOf('install'), 'Backspace')
    expect(got).not.toContain('##`install`')
    expect(got).toBe(after(doc, doc.indexOf('`install'), 'Backspace'))
  })
  test('does not glue a task box to its bold words', () => {
    const doc = 'one\n- [ ] **call** the bank'
    const got = after(doc, doc.indexOf('call'), 'Backspace')
    expect(got).not.toContain('[ ]**call**')
    expect(got).toBe(after(doc, doc.indexOf('**call'), 'Backspace'))
  })
  test('joins a line that opens with a bold word to the line above instead of taking its stars', () => {
    const doc = 'one\n**bold** z'
    expect(after(doc, doc.indexOf('bold'), 'Backspace')).toBe('one**bold** z')
  })
})
describe('with marks out of sight, Delete at the end of words that close with a mark', () => {
  test('joins the next line instead of taking the closing stars', () => {
    const doc = 'a **bold**\nnext'
    expect(after(doc, doc.indexOf('**\n'), 'Delete')).toBe('a **bold**next')
  })
})
describe('with marks out of sight, Backspace on a bold word from inside its closing stars', () => {
  test('takes the hidden stars with the last letter, as it does from outside them', () => {
    const doc = 'a **ab** z'
    const view = quietView(doc, doc.indexOf('** z'))
    press(view, 'Backspace')
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('a  z')
  })
})
