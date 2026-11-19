import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { setHeading, shiftHeading } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function ran(command: StateCommand, doc: string, at: number): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}
describe('edit27 heading commands with only a caret in a verbatim block', () => {
  test('a heading with the caret in a table row leaves the table whole', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(ran(setHeading(2), doc, doc.indexOf('1') + 1)).toBe(doc)
  })
  test('heading up with the caret in a table row leaves it alone', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(ran(shiftHeading(1), doc, doc.indexOf('1') + 1)).toBe(doc)
  })
  test('a heading with the caret in code writes no hashes', () => {
    const doc = '```\ncode\n```'
    expect(ran(setHeading(1), doc, doc.indexOf('code') + 2)).toBe(doc)
  })
  test('a heading with the caret in front matter keeps the properties', () => {
    const doc = '---\ntitle: x\n---\n\nbody'
    expect(ran(setHeading(2), doc, doc.indexOf('title') + 2)).toBe(doc)
  })
})
