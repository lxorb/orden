// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'
import { foldAtCaret } from './fold'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function folded(doc: string, line: string) {
  const end = doc.indexOf(line) + line.length
  const view = createEditor({ parent: document.body, doc, selection: { anchor: end } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: end }, userEvent: 'select' })
  foldAtCaret(view)
  view.dispatch({ selection: { anchor: end }, userEvent: 'select' })
  return view
}

describe('Enter at the end of a folded numbered item', () => {
  test('adds the new item after the hidden children when later items are renumbered', () => {
    const view = folded('1. item\n   - child\n2. next', '1. item')
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
    view.dispatch(view.state.replaceSelection('new'))
    expect(view.state.doc.toString()).toBe('1. item\n   - child\n2. new\n3. next')
  })
})
