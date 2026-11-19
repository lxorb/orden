import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function bolded(doc: string, picked: string): string {
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleWrap('**')({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}
describe('bold over a word picked inside a bold run', () => {
  test('takes the bold off that word and leaves the rest bold', () => {
    expect(bolded('a **very important** note', 'important')).toBe('a **very** important note')
  })
})
