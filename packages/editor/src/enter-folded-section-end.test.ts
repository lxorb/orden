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
function holdersOfTyped(view: EditorView, words: string): string[] {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  view.dispatch(view.state.replaceSelection(words))
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  const names: string[] = []
  const at = view.state.doc.toString().indexOf(words)
  for (let node = tree?.resolveInner(at, 1) ?? null; node; node = node.parent) names.push(node.name)
  return names
}
describe('words typed after Enter at the end of a folded heading', () => {
  test('do not join the last item of the hidden list', () => {
    const view = folded('## Shopping\n- milk\n- eggs\n\n## Later', '## Shopping')
    expect(holdersOfTyped(view, 'Ask Sam first.')).not.toContain('ListItem')
  })
  test('do not become a row of the hidden table', () => {
    const view = folded('## Costs\n| item | cost |\n| --- | --- |\n| tea | 2 |\n\n## Later', '## Costs')
    expect(holdersOfTyped(view, 'Ask Sam first.')).not.toContain('Table')
  })
  test('do not join the hidden quote', () => {
    const view = folded('## Said\n> Keep it short.\n\n## Later', '## Said')
    expect(holdersOfTyped(view, 'Ask Sam first.')).not.toContain('Blockquote')
  })
})
