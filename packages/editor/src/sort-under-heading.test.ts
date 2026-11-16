import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { reverseLines, sortLines } from './lines'

function after(command: StateCommand, doc: string, words: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf(words) + 1),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('Sort lines and Reverse lines next to a heading or list written with no blank line', () => {
  test('sorting the lines under a heading leaves the headings where they are', () => {
    const doc = '## Shopping\nmilk\neggs\nbread\n## Done\nsoap'
    expect(after(sortLines, doc, 'eggs')).toBe('## Shopping\nbread\neggs\nmilk\n## Done\nsoap')
  })

  test('reversing the lines under a heading keeps the heading on top', () => {
    const doc = '## Groceries\nmilk\neggs\nbread'
    expect(after(reverseLines, doc, 'eggs')).toBe('## Groceries\nbread\neggs\nmilk')
  })

  test('sorting with the caret on the line that introduces a list keeps that line above it', () => {
    const doc = 'Groceries:\n- pear\n- apple'
    expect(after(sortLines, doc, 'Groceries').startsWith('Groceries:\n')).toBe(true)
  })
})
