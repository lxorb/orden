// @vitest-environment jsdom
import { deleteCharBackward, deleteGroupBackward } from '@codemirror/commands'
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
const embeds = (view: EditorView) => view.contentDOM.querySelectorAll('.orden-embed').length
describe('words taken off the end of a note embed line', () => {
  test('the embed is drawn once the caret leaves, after a trailing word is deleted', () => {
    const doc = 'Intro\n\n![[Agenda]] draft'
    const view = viewOf(doc, doc.length)
    deleteGroupBackward(view)
    deleteCharBackward(view)
    expect(view.state.doc.toString()).toBe('Intro\n\n![[Agenda]]')
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' })
    expect(embeds(view)).toBe(1)
  })
  test('the embed is drawn once the caret leaves, after a stray space is deleted', () => {
    const doc = 'Intro\n\n![[Agenda]] '
    const view = viewOf(doc, doc.length)
    deleteCharBackward(view)
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' })
    expect(embeds(view)).toBe(1)
  })
  test('a table of contents is drawn once the caret leaves, after the words behind it are deleted', () => {
    const doc = 'Intro\n\n[toc] goes here, above the plan\n\n# One'
    const view = viewOf(doc, doc.indexOf(', above the plan') + ', above the plan'.length)
    const line = view.state.doc.line(3)
    view.dispatch({
      changes: { from: line.from + '[toc]'.length, to: line.to },
      selection: EditorSelection.cursor(line.from + '[toc]'.length),
      userEvent: 'delete.selection',
    })
    expect(view.state.doc.line(3).text).toBe('[toc]')
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' })
    expect(view.contentDOM.querySelectorAll('.orden-toc').length).toBe(1)
  })
  test('opening the same note draws it', () => {
    const view = viewOf('Intro\n\n![[Agenda]]', 0)
    expect(embeds(view)).toBe(1)
  })
})
