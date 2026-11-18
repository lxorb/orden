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

function viewOf(doc: string, from: number, to = from): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.range(from, to) })
  return view
}

function shown(view: EditorView, id: string): string | null {
  return sectionOf(view.state.doc.toString(), { heading: null, block: id })
}

const NOTE = 'intro\n\n- a\n- b\n\n^lid\n\nnext\n\nlast'

describe('moving blocks next to a list named by an id on its own line under it', () => {
  test('Move up on the paragraph under a named list does not land between the list and its id', () => {
    const doc = 'x\n\n- a\n- b\n\n^lid\n\nend'
    const view = viewOf(doc, doc.indexOf('end') + 1)
    moveBlocks(view, view.state.selection.main.head, -1)
    expect(shown(view, 'lid')).toBe('- a\n- b')
  })

  test('Move down on a one-item named list keeps the link on the list', () => {
    const doc = 'intro\n\n- x\n\n^lid\n\nnext\n\nlast'
    const view = viewOf(doc, doc.indexOf('- x') + 2)
    moveBlocks(view, view.state.selection.main.head, 1)
    expect(shown(view, 'lid')).toBe('- x')
  })

  test('Move up with the whole named list picked keeps the link on the list', () => {
    const from = NOTE.indexOf('- a')
    const view = viewOf(NOTE, from, NOTE.indexOf('- b') + 3)
    moveBlocks(view, from + 1, -1)
    expect(shown(view, 'lid')).toBe('- a\n- b')
  })

  test('Delete with the whole named list picked does not hand its id to the paragraph above', () => {
    const from = NOTE.indexOf('- a')
    const view = viewOf(NOTE, from, NOTE.indexOf('- b') + 3)
    deleteBlocks(view, from + 1)
    expect(shown(view, 'lid')).not.toBe('intro')
  })
})

describe('Turn into over a picked list and the id on its own line under it', () => {
  test('Turn into Numbered does not make the id an empty item', () => {
    const from = NOTE.indexOf('- a')
    const view = viewOf(NOTE, from, NOTE.indexOf('^lid') + 4)
    turnBlocksInto(view, from + 1, 'numbered')
    expect(view.state.doc.toString()).toBe('intro\n\n1. a\n2. b\n\n^lid\n\nnext\n\nlast')
  })

  test('Turn into Quote keeps the id on its own line', () => {
    const from = NOTE.indexOf('- a')
    const view = viewOf(NOTE, from, NOTE.indexOf('^lid') + 4)
    turnBlocksInto(view, from + 1, 'quote')
    expect(view.state.doc.toString()).toContain('\n\n^lid\n\n')
  })
})
