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

function after(doc: string, at: number): string {
  const view = quietView(doc, at)
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor')
  return view.state.doc.toString()
}

describe('with marks out of sight, Backspace at the start of a numbered item whose words open with a mark', () => {
  test('does not glue the number to the bold words', () => {
    const doc = 'one\n\n1. **Note**: words'
    const got = after(doc, doc.indexOf('Note'))
    expect(got).not.toContain('1.**Note**')
    expect(got).toBe(after(doc, doc.indexOf('**Note')))
  })

  test('does not glue a parenthesis number to its code words', () => {
    const doc = 'one\n\n1) `install` it'
    const got = after(doc, doc.indexOf('install'))
    expect(got).not.toContain('1)`install`')
    expect(got).toBe(after(doc, doc.indexOf('`install')))
  })
})
