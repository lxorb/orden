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

describe('edit30 a line copied with a triple click, pasted over another triple-clicked line', () => {
  test('an item over an item keeps the list tight', () => {
    expect(pastedOver('- one\n- two\n- three', '- two', '- one\n')).toBe('- one\n- one\n- three')
  })

  test('a paragraph line over a paragraph line adds no blank line', () => {
    expect(pastedOver('First.\nSecond.\nThird.', 'Second.', 'First.\n')).toBe(
      'First.\nFirst.\nThird.',
    )
  })
})
