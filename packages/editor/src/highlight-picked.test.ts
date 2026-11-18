import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { highlightSelection, setHighlightColour } from './highlight'
import { ordenMarkdownExtensions } from './markdown/extensions'

function pressed(doc: string, picked: string, emoji: string | null = null): string {
  const chosen = HIGHLIGHT_COLOURS.find((colour) => colour.emoji === emoji)
  if (chosen) setHighlightColour(chosen)
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  highlightSelection({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('highlight over a word picked inside a highlighted run', () => {
  test('takes the highlight off that word, as bold does, instead of nesting marks', () => {
    expect(pressed('a ==one two three== b', 'two')).toBe('a ==one== two ==three== b')
  })
  test('with another colour gives that word the new colour and keeps the rest as it was', () => {
    expect(pressed('a ==one two three== b', 'two', '🔴')).toBe('a ==one== ==🔴 two== ==three== b')
    expect(pressed('a ==🔴 one two three== b', 'two')).toBe('a ==🔴 one== ==two== ==🔴 three== b')
  })

  test('with the colour it already has takes a coloured highlight off that word', () => {
    expect(pressed('a ==🔴 one two three== b', 'two', '🔴')).toBe('a ==🔴 one== two ==🔴 three== b')
  })
})
