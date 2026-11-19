import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { keepsStraightQuotes } from './typography'

function straightAt(marked: string): boolean {
  const caret = marked.indexOf('|')
  const state = parsed(
    EditorState.create({
      doc: marked.replace('|', ''),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return keepsStraightQuotes(state, caret)
}
describe('front matter typed from the top, before its closing fence is written', () => {
  test('keeps its quotes straight, as closed front matter does', () => {
    expect(straightAt('---\ntitle: "a|\n---\n')).toBe(true)
    expect(straightAt('---\ntitle: |')).toBe(true)
    expect(straightAt('---\ntitle: Plan\ntags: [|\n\nBody words.\n')).toBe(true)
  })
})
