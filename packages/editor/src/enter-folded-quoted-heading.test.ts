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

function typedAfterEnter(view: EditorView, words: string) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  view.dispatch(view.state.replaceSelection(words))
}

function holderOf(view: EditorView, words: string, name: string): string | null {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  const at = view.state.doc.toString().indexOf(words)
  for (let node = tree?.resolveInner(at, 1) ?? null; node; node = node.parent) {
    if (node.name === name) return view.state.sliceDoc(node.from, node.to)
  }
  return null
}

describe('words typed after Enter at the end of a folded heading in a quote or callout', () => {
  test('do not join the last hidden paragraph of the callout', () => {
    const view = folded('> [!note] Plans\n> ## Monday\n> Call the bank.\n\nafter', '> ## Monday')
    typedAfterEnter(view, 'Ask Sam first.')
    expect(holderOf(view, 'Ask Sam first.', 'Paragraph')).not.toContain('Call the bank.')
  })

  test('leave the next heading of the quote a heading', () => {
    const view = folded('> ## Monday\n> Call the bank.\n> ## Tuesday\n> Rest.', '> ## Monday')
    typedAfterEnter(view, 'Ask Sam first.')
    expect(holderOf(view, 'Tuesday', 'ATXHeading2')).toBe('## Tuesday')
  })
})
