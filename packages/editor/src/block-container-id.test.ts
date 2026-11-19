// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { sectionOf } from '@orden/markdown/links'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { deleteBlocks, moveBlocks, turnBlocksInto } from './block/commands'
import { editorState } from './editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewAt(doc: string, words: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.cursor(doc.indexOf(words) + 1) })
  return view
}
function shown(view: EditorView, id: string): string | null {
  return sectionOf(view.state.doc.toString(), { heading: null, block: id })
}
const QUOTE = '> a\n>\n> b'
const ITEM = '- a\n\n  b'
describe('a paragraph inside a quote or item named by an id under the container', () => {
  test('Delete on the last paragraph of a named quote keeps the quote named', () => {
    const view = viewAt(`${QUOTE}\n\n^qid\n\nnext`, 'b')
    deleteBlocks(view, view.state.selection.main.head)
    expect(view.state.doc.toString()).toContain('^qid')
  })
  test('Move down on the last paragraph of a named quote leaves the id with the quote', () => {
    const view = viewAt(`${QUOTE}\n\n^qid\n\nnext`, 'b')
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(shown(view, 'qid')).toMatch(/^> a\n?>?$/u)
  })
  test('Move up on the last paragraph of a named quote keeps the quote whole', () => {
    const view = viewAt(`${QUOTE}\n\n^qid\n\nnext`, 'b')
    moveBlocks(view, view.state.selection.main.head, -1)
    expect(shown(view, 'qid')).toMatch(/^> b\n>\n> a/)
  })
  test('Delete on the second paragraph of a named list item keeps the list named', () => {
    const view = viewAt(`${ITEM}\n\n^lid\n\nnext`, '  b')
    deleteBlocks(view, view.state.selection.main.head)
    expect(view.state.doc.toString()).toContain('^lid')
  })
})
describe('Turn into on a block named by an id on its own line under it', () => {
  test('Turn into Bullet on a named quote keeps the link on the list', () => {
    const view = viewAt('> a\n\n^qid\n\nnext', 'a')
    turnBlocksInto(view, view.state.selection.main.head, 'bullet')
    expect(shown(view, 'qid')).toBe('- a')
  })
  test('Turn into Quote on a named paragraph keeps the link on the quote', () => {
    const view = viewAt('para\n\n^pid\n\nnext', 'para')
    turnBlocksInto(view, view.state.selection.main.head, 'quote')
    expect(shown(view, 'pid')).toBe('> para')
  })
})
