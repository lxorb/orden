import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildDecorations } from './live-preview/decorate'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function concealed(doc: string): string[] {
  const full = `${doc}\n\nx`
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const out: string[] = []
  buildDecorations(state).atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}
describe('words after an HTML comment that opens a line', () => {
  test('stay shown, as the reading view shows them', () => {
    expect(renderMarkdown('<!-- todo --> call the bank')).toContain('call the bank')
    expect(concealed('<!-- todo --> call the bank')).toEqual(['<!-- todo -->'])
  })
  test('stay shown on a paragraph line that the comment interrupts', () => {
    expect(concealed('Monday\n<!-- later --> buy milk')).toEqual(['<!-- later -->'])
  })
})
describe('words after a web frame that opens a line', () => {
  test('stay shown beside the frame, as the reading view shows them', () => {
    const doc = '<iframe src="https://www.youtube.com/embed/x"></iframe> watch this'
    expect(renderMarkdown(doc)).toContain('watch this')
    expect(concealed(doc)).toEqual(['<iframe src="https://www.youtube.com/embed/x"></iframe>'])
  })
})
