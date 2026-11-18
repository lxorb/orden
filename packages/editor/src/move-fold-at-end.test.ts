// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'
import { foldAtCaret } from './fold'
import { moveLineOver } from './list-keys'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function foldedAt(doc: string, line: string) {
  const end = doc.indexOf(line) + line.length
  const view = createEditor({ parent: document.body, doc, selection: { anchor: end } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: end }, userEvent: 'select' })
  foldAtCaret(view)
  return view
}

function caretOn(view: EditorView, words: string) {
  view.dispatch({
    selection: { anchor: view.state.doc.toString().indexOf(words) },
    userEvent: 'select',
  })
}

describe('moving a folded item that ends the note', () => {
  test('Alt+Down on the last folded item leaves its hidden child under it', () => {
    const view = foldedAt('- one\n- two\n  - child', '- two')
    caretOn(view, 'two')
    moveLineOver(1)(view)
    expect(view.state.doc.toString()).toBe('- one\n- two\n  - child')
  })

  test('Alt+Down on the last folded heading leaves its hidden words under it', () => {
    const view = foldedAt('# A\nintro\n\n# B\nend words', '# B')
    caretOn(view, 'B')
    moveLineOver(1)(view)
    expect(view.state.doc.toString()).toBe('# A\nintro\n\n# B\nend words')
  })
})
