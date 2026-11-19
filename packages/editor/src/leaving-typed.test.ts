// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { createEditor } from './editor'
import { ordenMarkdownParser } from './markdown/extensions'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function opened(doc: string): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  ensureSyntaxTree(view.state, doc.length, 10_000)
  view.dispatch({ selection: { anchor: doc.length }, userEvent: 'select' })
  return view
}
function enter(view: EditorView) {
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
}
function typed(view: EditorView, words: string) {
  const at = view.state.selection.main.head
  view.dispatch({
    changes: { from: at, insert: words },
    selection: { anchor: at + words.length },
    userEvent: 'input.type',
  })
}
function containersOf(doc: string, words: string): string[] {
  const at = doc.indexOf(words)
  const names: string[] = []
  const inner = ordenMarkdownParser.parse(doc).resolveInner(at, 1)
  for (let node = inner.parent; node; node = node.parent) names.push(node.name)
  return names.filter((name) => name !== 'Paragraph' && name !== 'Document')
}
function leftAndTyped(doc: string): string {
  const view = opened(doc)
  enter(view)
  enter(view)
  typed(view, 'Next paragraph')
  return view.state.doc.toString()
}
describe('words typed after a second Enter has ended the list or quote', () => {
  test('are not part of the last bullet', () => {
    const doc = leftAndTyped('- milk')
    expect(containersOf(doc, 'Next paragraph')).toEqual([])
    expect(renderMarkdown(doc)).not.toContain('milk\nNext paragraph')
  })
  test('are not part of the last numbered item', () => {
    expect(containersOf(leftAndTyped('1. first'), 'Next paragraph')).toEqual([])
  })
  test('are not part of the last task', () => {
    expect(containersOf(leftAndTyped('- [ ] call mum'), 'Next paragraph')).toEqual([])
  })
  test('are not part of the quote', () => {
    const doc = leftAndTyped('> a quote')
    expect(containersOf(doc, 'Next paragraph')).toEqual([])
    expect(renderMarkdown(doc)).not.toContain('a quote\nNext paragraph')
  })
  test('are not part of the callout body', () => {
    expect(containersOf(leftAndTyped('> [!note] Title\n> body'), 'Next paragraph')).toEqual([])
  })
})
