import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { reverseLines, sortLines } from './lines'

function after(command: StateCommand, doc: string, from: number, to: number): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}
describe('sorting a picked list', () => {
  test('a picked numbered list still counts up from one', () => {
    const doc = '1. pear\n2. apple\n3. fig'
    expect(after(sortLines, doc, 0, doc.length)).toBe('1. apple\n2. fig\n3. pear')
  })
  test('a picked list keeps each child under its own item', () => {
    const doc = '- b\n  - x\n- a\n  - y'
    expect(after(sortLines, doc, 0, doc.length)).toBe('- a\n  - y\n- b\n  - x')
  })
  test('reversing a picked list keeps each child under its own item', () => {
    const doc = '- a\n  - a1\n- b'
    expect(after(reverseLines, doc, 0, doc.length)).toBe('- b\n- a\n  - a1')
  })
})
