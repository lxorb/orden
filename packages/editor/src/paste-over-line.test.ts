import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed } from './paste-place'

function pastedOver(doc: string, line: string, text: string): string {
  const from = doc.indexOf(line)
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + line.length + 1),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return state.update(placed(state, text)).state.doc.toString()
}
describe('edit29 a paste copied in Orden over a line picked with a triple click', () => {
  test('a list over an item keeps the next item on its own line', () => {
    expect(pastedOver('- one\n- two\n- three', '- two', '- x\n- y')).toBe('- one\n- x\n- y\n- three')
  })
  test('words over a paragraph line keep the next line apart', () => {
    expect(pastedOver('Old words.\nNext line.', 'Old words.', '**New** words.')).toBe('**New** words.\nNext line.')
  })
  test('a quote over an item does not swallow the next item', () => {
    expect(pastedOver('- one\n- two\n- three', '- two', '> q')).toBe('- one\n> q\n- three')
  })
})
