// @vitest-environment jsdom
import { ensureSyntaxTree, foldedRanges } from '@codemirror/language'
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

describe('moving a line next to folded content', () => {
  test('Alt+Up under a folded item moves over the item and its hidden children', () => {
    const view = foldedAt('- one\n- two\n  - child\n- three', '- two')
    caretOn(view, 'three')
    moveLineOver(-1)(view)
    expect(view.state.doc.toString()).toBe('- one\n- three\n- two\n  - child')
    const kept: string[] = []
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      kept.push(view.state.sliceDoc(from, to))
    })
    expect(kept).toEqual(['\n  - child'])
  })

  test('Alt+Down on a folded heading keeps its hidden words under it', () => {
    const view = foldedAt('# A\npara one\n\n# B\nend', '# A')
    caretOn(view, 'A')
    moveLineOver(1)(view)
    expect(view.state.doc.toString()).toContain('# A\npara one')
  })
})
