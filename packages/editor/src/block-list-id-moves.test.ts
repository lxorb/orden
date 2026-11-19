// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { duplicateBlocks, moveBlocks } from './block/commands'
import { editorState } from './editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, from: number, to = from): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.range(from, to) })
  return view
}
describe('Move down on the item above the last item of a list named by an id under it', () => {
  test('swaps the two items', () => {
    const doc = 'intro\n\n- a\n- b\n\n^lid\n\nnext'
    const view = viewOf(doc, doc.indexOf('- a') + 2)
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(view.state.doc.toString()).toBe('intro\n\n- b\n- a\n\n^lid\n\nnext')
  })
  test('a nested item swaps with the nested item under it instead of leaving its parent upwards', () => {
    const doc = 'intro\n\n- a\n  - a1\n  - a2\n\n^lid\n\nnext'
    const view = viewOf(doc, doc.indexOf('- a1') + 2)
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(view.state.doc.toString()).toBe('intro\n\n- a\n  - a2\n  - a1\n\n^lid\n\nnext')
  })
})
describe('Duplicate with a whole list picked that is named by an id under it', () => {
  test('copies each item in place and keeps the list in one piece', () => {
    const doc = 'intro\n\n- a\n- b\n\n^lid\n\nnext'
    const from = doc.indexOf('- a')
    const view = viewOf(doc, from, doc.indexOf('- b') + 3)
    duplicateBlocks(view, from + 1)
    expect(view.state.doc.toString()).toBe('intro\n\n- a\n- a\n- b\n- b\n\n^lid\n\nnext')
  })
  test('does not leave a copied child item stranded under the id', () => {
    const doc = 'intro\n\n- a\n- b\n  - b1\n\n^lid\n\nnext'
    const from = doc.indexOf('- a')
    const view = viewOf(doc, from, doc.indexOf('- b1') + 4)
    duplicateBlocks(view, from + 1)
    expect(view.state.doc.toString()).not.toContain('^lid\n\n  - b1')
  })
})
