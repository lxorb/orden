import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { setHighlightColour, highlightSelection } from './highlight'
import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { ordenMarkdownExtensions } from './markdown/extensions'

function pressed(doc: string, at: number): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  highlightSelection({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('highlight with the caret inside a highlighted word', () => {
  test('takes the highlight off, as bold does, rather than putting empty marks inside it', () => {
    const plain = HIGHLIGHT_COLOURS.find((colour) => colour.emoji === null)
    if (plain) setHighlightColour(plain)
    const doc = 'a ==highlighted== word'
    expect(pressed(doc, doc.indexOf('light'))).toBe('a highlighted word')
  })
})
