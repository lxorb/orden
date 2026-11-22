// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

const NOTE = 'today:\n- [ ] numcs (20min)\n- [x] numcs (20min)\n- a bullet\n\nend'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function shown(): EditorView {
  const view = createEditor({ parent: document.body, doc: NOTE })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  return view
}
const select = (view: EditorView, at: number) => view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
describe('the start of the words on a task line', () => {
  test('a caret put there leans on the box, so it is drawn in the gap after it', () => {
    const view = shown()
    const words = NOTE.indexOf('numcs')
    select(view, words)
    expect(view.state.selection.main.head).toBe(words)
    expect(view.state.selection.main.assoc).toBe(-1)
  })
  test('a caret put inside the hidden box mark lands there too, leaning on the box', () => {
    const view = shown()
    const done = NOTE.indexOf('- [x]')
    select(view, done + 2)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('numcs', done))
    expect(view.state.selection.main.assoc).toBe(-1)
  })
  test('the space after the box is part of the box, not a letter before the words', () => {
    const view = shown()
    const line = [...view.contentDOM.querySelectorAll('.cm-line')].find((one) => one.querySelector('.orden-task-box'))
    expect(line?.textContent.startsWith('numcs')).toBe(true)
  })
  test('a bullet line keeps its caret as it was', () => {
    const view = shown()
    select(view, NOTE.indexOf('a bullet'))
    expect(view.state.selection.main.assoc).toBe(0)
  })
})
