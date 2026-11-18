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

describe('a note embed beside a block that stands on its own', () => {
  test('under a rule is drawn as the note, as the reading view draws it', () => {
    const doc = 'Top\n\n---\n![[Plan]]'
    expect(embeds(doc)).toBe(1)
    expect(blocks(doc)).toEqual(['![[Plan]]'])
  })

  test('under a code block is drawn as the note, as the reading view draws it', () => {
    const doc = '```\ncode\n```\n![[Plan]]'
    expect(embeds(doc)).toBe(1)
    expect(blocks(doc)).toEqual(['![[Plan]]'])
  })
})
