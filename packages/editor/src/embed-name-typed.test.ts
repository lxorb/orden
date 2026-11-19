// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from './editor'
import { parsed } from '../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, at: number): EditorView {
  const view = new EditorView({
    state: parsed(editorState({ doc, selection: { anchor: at } })),
    parent: document.body,
  })
  open.push(view)
  view.dispatch({ selection: EditorSelection.cursor(at), userEvent: 'select' })
  return view
}
function type(view: EditorView, words: string) {
  for (const character of words) {
    const at = view.state.selection.main.head
    view.dispatch({
      changes: { from: at, insert: character },
      selection: EditorSelection.cursor(at + character.length),
      userEvent: 'input.type',
    })
  }
}
const embeds = (view: EditorView) => view.contentDOM.querySelectorAll('.orden-embed').length
describe('a note embed whose name is typed between brackets already closed', () => {
  test('is drawn once the caret leaves the line', () => {
    const doc = 'Intro\n\n![[]]\n\nend'
    const view = viewOf(doc, doc.indexOf(']]'))
    type(view, 'Agenda')
    expect(view.state.doc.line(3).text).toBe('![[Agenda]]')
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' })
    expect(embeds(view)).toBe(1)
  })
  test('is drawn once the caret leaves the line, after a closing bracket typed by hand', () => {
    const doc = 'Intro\n\n![[Agend]]\n\nend'
    const view = viewOf(doc, 0)
    expect(embeds(view)).toBe(1)
  })
})
