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

describe('Enter at the end of a folded heading, then a new heading typed', () => {
  test('keeps the hidden words under their own heading', () => {
    const view = folded('# Plan\nStep one.\nStep two.\n\n# Later', '# Plan')
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')).toBe(
      true,
    )
    view.dispatch(view.state.replaceSelection('# Next'))
    const doc = view.state.doc.toString()
    expect(doc.indexOf('Step one.')).toBeLessThan(doc.indexOf('# Next'))
  })
})
