import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildBlockDecorations } from './live-preview/blocks'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function blocks(doc: string): string[] {
  const full = `${doc}\n\nx`
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const out: string[] = []
  buildBlockDecorations(state).between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}
describe('a note embed on the line right under a heading', () => {
  test('is drawn as the note, as the reading view draws it', () => {
    const doc = '## Plan\n![[Plan]]'
    expect(renderMarkdown(doc, { resolveEmbed: () => 'words' })).toContain('class="embed"')
    expect(blocks(doc)).toEqual(['![[Plan]]'])
  })
  test('right after front matter is drawn as the note', () => {
    expect(blocks('---\ntags: a\n---\n![[Plan]]')).toEqual(['![[Plan]]'])
  })
})
