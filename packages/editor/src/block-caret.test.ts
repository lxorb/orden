// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { deleteBlocks, duplicateBlocks, turnBlocksInto } from './block/commands'
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

function viewAt(doc: string, words: string): EditorView {
  const view = new EditorView({
    state: parsed(editorState({ doc, selection: { anchor: doc.indexOf(words) } })),
    parent: document.body,
  })
  open.push(view)
  return view
}

describe('typing straight after a block command on a list item', () => {
  test('Duplicate on a bullet leaves the caret after the hidden marker of the copy', () => {
    const view = viewAt('- milk\n- eggs\n- bread\n', 'eggs')
    duplicateBlocks(view, view.state.selection.main.head)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.toString().split('\n')).not.toContain('x- eggs')
  })

  test('Duplicate on a task leaves the caret after the hidden box of the copy', () => {
    const view = viewAt('- [ ] milk\n- [ ] eggs\n', 'eggs')
    duplicateBlocks(view, view.state.selection.main.head)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.toString().split('\n')).not.toContain('x- [ ] eggs')
  })

  test('Delete on a bullet leaves the caret after the hidden marker of the next item', () => {
    const view = viewAt('- milk\n- eggs\n- bread\n', 'eggs')
    deleteBlocks(view, view.state.selection.main.head)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.toString().split('\n')).not.toContain('x- bread')
  })

  test('Turn into bullet with the caret before the words leaves it after the new hidden marker', () => {
    const view = viewAt('milk\n\neggs\n', 'eggs')
    turnBlocksInto(view, view.state.selection.main.head, 'bullet')
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.toString()).toBe('milk\n\n- xeggs\n')
  })
})
