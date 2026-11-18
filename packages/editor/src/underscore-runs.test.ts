import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function pressed(mark: string, doc: string, picked: string): string {
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleWrap(mark)({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('taking a mark off a word picked inside a run written with underscores', () => {
  test('italic over a word inside an underscore run closes and reopens it with underscores', () => {
    expect(pressed('*', 'a _one two three_ b', 'two')).toBe('a _one_ two _three_ b')
  })

  test('bold over a word inside a double underscore run keeps the run whole on each side', () => {
    expect(pressed('**', 'a __one two three__ b', 'two')).toBe('a __one__ two __three__ b')
  })

  test('bold over the first word of a double underscore run leaves the rest bold', () => {
    expect(pressed('**', 'a __one two__ b', 'one')).toBe('a one __two__ b')
  })
})
