import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { highlightTone } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleHighlight } from './highlight'
import { ordenMarkdownExtensions } from './markdown/extensions'

const RED = highlightTone(1)
const BLUE = highlightTone(5)
function stateAt(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
describe('a coloured highlight started at a caret and pressed again', () => {
  test('the same colour takes the empty highlight off', () => {
    let state = stateAt('be  here', 3)
    const press = toggleHighlight(RED)
    press({ state, dispatch: (one: Transaction) => (state = one.state) })
    press({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('be  here')
  })
  test('another colour swaps the colour instead of adding a second one', () => {
    let state = stateAt('be  here', 3)
    toggleHighlight(RED)({ state, dispatch: (one: Transaction) => (state = one.state) })
    toggleHighlight(BLUE)({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('be ==🔵 == here')
  })
})
