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

function enterThenType(view: EditorView, words: string): string {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  view.dispatch(view.state.replaceSelection(words))
  return view.state.doc.toString()
}

describe('Enter at the end of a folded code fence opening line inside a quote', () => {
  test('keeps the new line inside the callout, which stays one callout', () => {
    const view = folded('> [!tip] Install\n> ```sh\n> npm i\n> ```\n> Then run it.', '> ```sh')
    expect(enterThenType(view, 'Done.')).toBe(
      '> [!tip] Install\n> ```sh\n> npm i\n> ```\n> Done.\n> Then run it.',
    )
  })

  test('keeps the new line inside a plain quote', () => {
    const view = folded('> ```sh\n> npm i\n> ```\n\nafter', '> ```sh')
    expect(enterThenType(view, 'Done.')).toBe('> ```sh\n> npm i\n> ```\n> Done.\n\nafter')
  })
})
