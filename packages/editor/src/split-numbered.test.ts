// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { createEditor } from './editor'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function opened(doc: string, caret: number): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: caret } })
  open.push(view)
  ensureSyntaxTree(view.state, doc.length, 10_000)
  view.dispatch({ selection: { anchor: caret }, userEvent: 'select' })
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

function splitAfter(doc: string, item: string): string {
  const view = opened(doc, doc.indexOf(item) + item.length)
  enter(view)
  enter(view)
  typed(view, 'Between')
  return view.state.doc.toString()
}

describe('a numbered list split by Enter twice after an item, then words typed', () => {
  test('keeps the items below as a list', () => {
    const html = renderMarkdown(splitAfter('1. one\n2. two\n3. three', '1. one'))
    expect(html).toContain('<p>Between</p>')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<li>three</li>')
  })

  test('keeps the numbered tasks below as tasks', () => {
    const html = renderMarkdown(splitAfter('1. [ ] one\n2. [ ] two', '1. [ ] one'))
    expect(html).toContain('<p>Between</p>')
    expect(html.split('task-list-item').length - 1).toBe(2)
  })

  test('keeps the items below as a list inside a quote', () => {
    const html = renderMarkdown(splitAfter('> 1. one\n> 2. two', '> 1. one'))
    expect(html).toContain('<p>Between</p>')
    expect(html).toContain('<li>two</li>')
  })
})
