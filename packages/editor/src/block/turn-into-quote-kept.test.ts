// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { turnBlocksInto } from './commands'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function turnedIntoQuote(doc: string, words: string, picked = false): string {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  if (picked) view.dispatch({ selection: { anchor: 0, head: doc.length } })
  turnBlocksInto(view, doc.indexOf(words) + 1, 'quote')
  return view.state.doc.toString()
}
describe('Turn into quote on blocks holding a quote of several paragraphs', () => {
  test('a paragraph and the quote under it, picked together, stay one quote', () => {
    const doc = 'Intro words.\n\n> First words.\n>\n> Second words.'
    expect(turnedIntoQuote(doc, 'Intro', true)).toBe('> Intro words.\n\n> First words.\n>\n> Second words.')
  })
  test('a callout of two paragraphs keeps its second paragraph', () => {
    const doc = '> [!note] Title\n> Body words.\n>\n> More words.\n\nAfter.'
    expect(turnedIntoQuote(doc, 'Body')).toBe(doc)
  })
})
