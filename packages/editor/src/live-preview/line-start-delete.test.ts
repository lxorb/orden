// @vitest-environment jsdom
import { cursorLineBoundaryBackward, deleteLineBoundaryBackward } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { editorState } from '../editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewAtEnd(doc: string, words: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  const at = doc.indexOf(words) + words.length
  view.dispatch({ selection: EditorSelection.cursor(at), userEvent: 'select' })
  return view
}

describe('Cmd-Backspace on mac, delete to the line start, in a list item', () => {
  test('Home stops after the hidden bullet', () => {
    const doc = 'intro\n\n- milk\n- eggs and bread\n- tea\n\nend'
    const view = viewAtEnd(doc, 'eggs and bread')
    cursorLineBoundaryBackward(view)
    expect(view.state.selection.main.head).toBe(doc.indexOf('eggs'))
  })

  test('takes the words of a bullet and keeps the bullet', () => {
    const doc = 'intro\n\n- milk\n- eggs and bread\n- tea\n\nend'
    const view = viewAtEnd(doc, 'eggs and bread')
    deleteLineBoundaryBackward(view)
    expect(view.state.doc.toString()).toBe('intro\n\n- milk\n- \n- tea\n\nend')
  })

  test('takes the words of a task and keeps its box', () => {
    const doc = 'intro\n\n- [ ] buy milk\n\nend'
    const view = viewAtEnd(doc, 'buy milk')
    deleteLineBoundaryBackward(view)
    expect(view.state.doc.toString()).toBe('intro\n\n- [ ] \n\nend')
  })
})
