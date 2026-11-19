import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { highlightTone } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleHighlight } from './highlight'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { clearFormatting, highlightAcross } from './marks'

const RED = highlightTone(1)
function stateOf(doc: string, from: number, to = from): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
function typedAfter(state: EditorState, words: string): string {
  const { from, to } = state.selection.main
  return state.update({ changes: { from, to, insert: words } }).state.doc.toString()
}
describe('a coloured highlight started at a caret', () => {
  test('keeps its colour when the words are typed in', () => {
    let state = stateOf('be  here', 3)
    toggleHighlight(RED)({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(typedAfter(state, 'careful')).toBe('be ==🔴 careful== here')
  })
})
describe('a highlight over two blocks of a quote', () => {
  test('goes on each paragraph', () => {
    const doc = '> a\n>\n> b'
    let state = stateOf(doc, 0, doc.length)
    highlightAcross(RED)({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('> ==🔴 a==\n>\n> ==🔴 b==')
  })
})
describe('clear formatting over a coloured highlight', () => {
  test('takes the colour off along with the marks', () => {
    const doc = 'be ==🔴 careful== here'
    let state = stateOf(doc, 0, doc.length)
    clearFormatting({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('be careful here')
  })
})
