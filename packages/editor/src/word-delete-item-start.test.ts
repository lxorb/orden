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

function wordBackspace(view: EditorView) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true }), 'editor')
}

describe('Ctrl+Backspace at the start of an item, where Home puts the caret', () => {
  test('takes the bullet off instead of gluing a bare dash to the words', () => {
    const view = viewAt('- item', '- '.length)
    wordBackspace(view)
    expect(view.state.doc.toString()).not.toBe('-item')
    expect(view.state.doc.toString()).toBe('item')
  })

  test('does the same with marks out of sight', () => {
    const view = viewAt('- item', '- '.length, true)
    wordBackspace(view)
    expect(view.state.doc.toString()).toBe('item')
  })

  test('does not glue a task box to its words, which ends the task', () => {
    const view = viewAt('- [ ] task', '- [ ] '.length)
    wordBackspace(view)
    expect(view.state.doc.toString()).not.toBe('- [ ]task')
  })
})
