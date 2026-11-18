import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { titleCase, upperCase } from './case'
import { ordenMarkdownExtensions } from './markdown/extensions'

function recasedNote(command: StateCommand, doc: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('changing case over a wikilink to a block, with no alias', () => {
  test('upper case leaves the block id the link points to alone', () => {
    expect(recasedNote(upperCase, 'see [[Plan#^step-1]] now')).toContain('#^step-1]]')
  })

  test('title case leaves the block id of an embed alone', () => {
    expect(recasedNote(titleCase, 'the steps ![[Plan#^a1b2c3]]')).toContain('#^a1b2c3]]')
  })

  test('upper case leaves a same-note block link alone', () => {
    expect(recasedNote(upperCase, 'back to [[#^intro1]]')).toBe('BACK TO [[#^intro1]]')
  })
})
