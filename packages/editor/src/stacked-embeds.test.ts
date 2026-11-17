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

const embeds = (doc: string) =>
  (renderMarkdown(doc, { resolveEmbed: () => 'words' }).match(/class="embed"/g) ?? []).length

describe('note embeds written on lines one under another', () => {
  test('two are each drawn as the note, as the reading view draws them', () => {
    const doc = 'Today\n\n![[Plan]]\n![[Groceries]]'
    expect(embeds(doc)).toBe(2)
    expect(blocks(doc)).toEqual(['![[Plan]]', '![[Groceries]]'])
  })

  test('three sections of one note are each drawn', () => {
    const doc = '![[Week#Monday]]\n![[Week#Tuesday]]\n![[Week#Wednesday]]'
    expect(blocks(doc)).toEqual(['![[Week#Monday]]', '![[Week#Tuesday]]', '![[Week#Wednesday]]'])
  })
})
