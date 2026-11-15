import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function over(doc: string, command: StateCommand): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('small marks and links over whole lines', () => {
  test('bold over a whole footnote definition keeps its label outside', () => {
    expect(over('[^1]: a note', toggleWrap('**'))).toBe('[^1]: **a note**')
  })
})
