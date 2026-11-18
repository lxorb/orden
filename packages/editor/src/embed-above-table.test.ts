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

describe('a note embed on the line right above a block that ends a paragraph', () => {
  test('above a table is drawn as the note, as the reading view draws it', () => {
    const table = '| Task | Owner |\n| --- | --- |\n| Draft | Ana |'
    const doc = `## Standup\n![[Agenda]]\n${table}`
    expect(embeds(doc)).toBe(1)
    expect(blocks(doc)).toEqual(['![[Agenda]]', table])
  })

  test('above an HTML block is drawn as the note, as the reading view draws it', () => {
    const doc = '![[Agenda]]\n<div align="center">\nfooter\n</div>'
    expect(embeds(doc)).toBe(1)
    expect(blocks(doc)[0]).toBe('![[Agenda]]')
  })
})
