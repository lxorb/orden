import { EditorState, type EditorView, type TransactionSpec } from '@orden/editor'
import { describe, expect, test } from 'vitest'
import { handwritingName, placedAtCaret } from './handwrite'

function viewOf(doc: string, from: number, to = from): EditorView {
  const view = {
    state: EditorState.create({ doc, selection: { anchor: from, head: to } }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state
    },
  }
  return view as unknown as EditorView
}
describe('a handwriting', () => {
  test('is named for the moment it was started, to the second', () => {
    expect(handwritingName(new Date(2026, 10, 17, 9, 5, 7))).toBe('handwriting-2026-11-17-090507.canvas')
  })
  test('stands as a paragraph of its own after the words before the caret', () => {
    const view = viewOf('milk and eggs', 4)
    placedAtCaret(view, '![[h.canvas]]')
    expect(view.state.doc.toString()).toBe('milk\n\n![[h.canvas]]\n\n and eggs')
    expect(view.state.selection.main.head).toBe('milk\n\n![[h.canvas]]\n\n'.length)
  })
  test('on an empty line under words it keeps one blank line between them', () => {
    const view = viewOf('one\n\ntwo', 4)
    placedAtCaret(view, '![[h.canvas]]')
    expect(view.state.doc.toString()).toBe('one\n\n![[h.canvas]]\n\n\ntwo')
  })
  test('at the end of a line with room below, it uses that room for the caret', () => {
    const view = viewOf('one\n\ntwo', 3)
    placedAtCaret(view, '![[h.canvas]]')
    expect(view.state.doc.toString()).toBe('one\n\n![[h.canvas]]\n\n\ntwo')
    const caret = view.state.doc.lineAt(view.state.selection.main.head)
    expect(caret.text).toBe('')
    expect(view.state.doc.line(caret.number - 1).text).toBe('')
    expect(view.state.doc.line(caret.number + 1).text).toBe('two')
  })
  test('at the very start it adds nothing above', () => {
    const view = viewOf('', 0)
    placedAtCaret(view, '![[h.canvas]]')
    expect(view.state.doc.toString()).toBe('![[h.canvas]]\n\n')
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })
  test('in place of what was picked', () => {
    const view = viewOf('keep this away', 5, 9)
    placedAtCaret(view, '![[h.canvas]]')
    expect(view.state.doc.toString()).toBe('keep \n\n![[h.canvas]]\n\n away')
  })
})
