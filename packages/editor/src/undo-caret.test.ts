// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor, editorState } from './editor'
import { HeldState } from './held'
import { SharedDoc, undoEdit } from './shared'

const NOTE = Array.from({ length: 40 }, (_, line) => `line ${line}`).join('\n')
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function type(view: EditorView, at: number) {
  view.dispatch({
    changes: { from: at, insert: 'x' },
    selection: { anchor: at + 1 },
    userEvent: 'input.type',
  })
}
test('an undo after typing at the caret a tab opened with goes back to that caret', () => {
  const note = new SharedDoc(NOTE)
  const at = NOTE.indexOf('line 30')
  const view = createEditor({ parent: document.body, doc: '' })
  open.push(view)
  HeldState.waiting(note, editorState({ shared: note, selection: { anchor: at } })).give(view)
  type(view, at)
  undoEdit(view)
  expect(view.state.doc.toString()).toBe(NOTE)
  expect(view.state.selection.main.head).toBe(at)
})
test("an undo in one pane goes back to its own caret, not the other pane's", () => {
  const note = new SharedDoc(NOTE)
  const left = createEditor({ parent: document.body, shared: note, selection: { anchor: 41 } })
  const right = createEditor({ parent: document.body, shared: note, selection: { anchor: 277 } })
  open.push(left, right)
  left.dispatch({ selection: { anchor: 41 } })
  right.dispatch({ selection: { anchor: 277 } })
  type(left, 41)
  undoEdit(left)
  expect(left.state.selection.main.head).toBe(41)
})
