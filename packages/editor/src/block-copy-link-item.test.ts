// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { sectionOf } from '@orden/markdown/links'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { blockTarget } from './block/commands'
import { editorState } from './editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function linked(doc: string, words: string): string | null {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  const pos = doc.indexOf(words) + 1
  view.dispatch({ selection: EditorSelection.cursor(pos) })
  const target = blockTarget(view, pos) ?? ''
  return sectionOf(view.state.doc.toString(), { heading: null, block: target.slice(2) })
}

describe('Copy link on the last item of a list named by an id on its own line', () => {
  test('a bulleted item links to that item, not the whole list', () => {
    expect(linked('- a\n- b\n\n^lid\n\nnext', '- b')).toBe('- b')
  })

  test('a numbered item links to that item, not the whole list', () => {
    expect(linked('1. a\n2. b\n\n^lid\n\nnext', '2. b')).toBe('2. b')
  })
})
