// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { sectionOf } from '@orden/markdown/links'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { deleteBlocks, moveBlocks } from './commands'
import { editorState } from '../editor'
import { moveLineOver } from '../list-keys'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
const TABLE = '| a |\n| - |\n| 1 |'
const FENCE = '```\ncode\n```'
function viewAt(doc: string, words: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.cursor(doc.indexOf(words) + 1) })
  return view
}
function shown(view: EditorView, id: string): string | null {
  return sectionOf(view.state.doc.toString(), { heading: null, block: id })
}
describe('moving a block that Orden named with an id on its own line under it', () => {
  test('Move down on a named table keeps the link on the table', () => {
    const view = viewAt(`intro\n\n${TABLE}\n\n^tid\n\nnext\n\nlast`, '| 1 |')
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(shown(view, 'tid')).toBe(TABLE)
  })
  test('Move up on a named code fence keeps the link on the code', () => {
    const view = viewAt(`intro\n\n${FENCE}\n\n^fid\n\nnext`, 'code')
    moveBlocks(view, view.state.selection.main.head, -1)
    expect(shown(view, 'fid')).toBe(FENCE)
  })
  test('Move down on a paragraph above a named table does not land between the table and its id', () => {
    const view = viewAt(`intro\n\n${TABLE}\n\n^tid\n\nnext`, 'intro')
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(shown(view, 'tid')).toBe(TABLE)
  })
  test('Delete on a named code fence does not hand its id to the block above', () => {
    const view = viewAt(`intro\n\n${FENCE}\n\n^fid\n\nnext`, 'code')
    deleteBlocks(view, view.state.selection.main.head)
    expect(shown(view, 'fid')).toBeNull()
  })
  test('Alt-Down on a line above a named table does not land between the table and its id', () => {
    const view = viewAt(`x\n\n${TABLE}\n\n^tid\n\nend`, 'x')
    moveLineOver(1)(view)
    expect(shown(view, 'tid')).toBe(TABLE)
  })
})
