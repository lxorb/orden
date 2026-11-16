// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewAt(doc: string, at: number) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: at } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}

function wordKey(view: EditorView, key: 'Backspace' | 'Delete') {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor')
}

describe('word delete beside a marked run whose edge word holds other markup', () => {
  test('Ctrl+Backspace after bold ending in italic words keeps the italic closed', () => {
    const doc = 'a **one *two three*** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    const text = view.state.doc.toString()
    expect(['a **one *two*** z', 'a **one** z']).toContain(text)
  })

  test('Ctrl+Backspace after a bold italic run of two words keeps both marks closed', () => {
    const doc = 'a ***one two*** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(['a ***one*** z', 'a  z', 'a z']).toContain(view.state.doc.toString())
  })

  test('Ctrl+Backspace after bold ending in a link keeps the link whole or gone', () => {
    const doc = 'a **read [the guide](https://x.test)** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    const text = view.state.doc.toString()
    expect(text).not.toContain('[the**')
    expect(text === 'a **read** z' || text.includes('[the guide](https://x.test)')).toBe(true)
  })

  test('Ctrl+Backspace after bold ending in inline code keeps the code closed', () => {
    const doc = 'a **run `npm install`** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    const text = view.state.doc.toString()
    expect((text.match(/`/g) ?? []).length % 2).toBe(0)
  })

  test('Ctrl+Delete before bold starting with a link keeps the link whole or gone', () => {
    const doc = 'a **[the guide](https://x.test) here** z'
    const view = viewAt(doc, 1)
    wordKey(view, 'Delete')
    const text = view.state.doc.toString()
    expect(text).not.toContain('guide](https://x.test)** z')
    expect(text).not.toMatch(/^a \*\*guide/)
  })

  test('Ctrl+Delete before a coloured highlight takes its first word, not its colour', () => {
    const doc = 'a ==🔴 one two== z'
    const view = viewAt(doc, 1)
    wordKey(view, 'Delete')
    expect(view.state.doc.toString()).toBe('a ==🔴 two== z')
  })

  test('Ctrl+Backspace after a coloured highlight of one word leaves no empty highlight', () => {
    const doc = 'a ==🔴 one== z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.toString()).not.toContain('==🔴==')
  })

  test('Ctrl+Backspace after a bold run broken over two lines keeps the line break', () => {
    const doc = 'a **one\ntwo** z'
    const view = viewAt(doc, doc.indexOf('z'))
    wordKey(view, 'Backspace')
    expect(view.state.doc.lines).toBe(2)
  })
})
