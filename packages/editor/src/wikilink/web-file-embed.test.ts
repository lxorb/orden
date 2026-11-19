import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { parsed } from '../../test/parsed'
import { buildBlockDecorations } from '../live-preview/blocks'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { type NoteIndex, noteIndex } from './notes'

const shortcut = (path: string) => ({ path, name: path, headings: [], blocks: [], aliases: [] })

const index: NoteIndex = {
  notes: [
    { path: 'Today.md', name: 'Today', headings: [], blocks: [], aliases: [] },
    shortcut('Recipe.url'),
    shortcut('Soup.webloc'),
  ],
  files: ['Recipe.url', 'Soup.webloc', 'Sketch.pages', 'Plan.md'],
  path: 'Today.md',
  read: () => Promise.resolve('[InternetShortcut]\nURL=https://example.com/soup\n'),
}

function drawnAsNotes(doc: string): string[] {
  const full = `${doc}\n\nx`
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(index)],
    }),
  )
  const out: string[] = []
  buildBlockDecorations(state).between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

describe('a file that opens in its own tab, embedded in a note, in Live Preview', () => {
  test('a .url is drawn as a link, not as its raw shortcut lines', () => {
    expect(drawnAsNotes('![[Recipe.url]]')).toEqual([])
  })

  test('a .webloc is drawn as a link, not as the text of its property list', () => {
    expect(drawnAsNotes('![[Soup.webloc]]')).toEqual([])
  })

  test('a page note is drawn as a link, not as a note that cannot be found', () => {
    expect(drawnAsNotes('![[Sketch.pages]]')).toEqual([])
  })

  test('a web link named without its extension is drawn as a link too', () => {
    expect(drawnAsNotes('![[Recipe]]')).toEqual([])
  })

  test('a note is still drawn as the note', () => {
    expect(drawnAsNotes('![[Plan]]')).toEqual(['![[Plan]]'])
  })

  test('the reading view draws them as links too', () => {
    const html = renderMarkdown('![[Recipe.url]]\n', {
      resolveEmbed: () => '[InternetShortcut]\nURL=https://example.com/soup\n',
      resolveLink: (one) => ({ href: `/space/${one.target}` }),
    })
    expect(html).toContain('href="/space/Recipe.url"')
  })
})
