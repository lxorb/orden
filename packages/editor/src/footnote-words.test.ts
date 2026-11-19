import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildDecorations } from './live-preview/decorate'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function shown(doc: string): string {
  const full = `${doc}\n\nx`
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  let out = ''
  let at = 0
  buildDecorations(state).atomic.between(0, full.length, (from, to) => {
    out += full.slice(at, from)
    at = to
  })
  return out + full.slice(at, full.length - 3)
}
function linked(doc: string): string[] {
  const full = `${doc}\n\nx`
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const out: string[] = []
  buildDecorations(state).decorations.between(0, full.length, (from, to, value) => {
    if (String(value.spec.class ?? '').includes('orden-link')) out.push(full.slice(from, to))
  })
  return out
}
describe('the words of a footnote definition', () => {
  const doc = 'Claim[^1].\n\n[^1]: See [the docs](https://x.test) and **this** part.'
  test('are drawn with their bold and links, as the reading view draws them', () => {
    const read = renderMarkdown(doc)
    expect(read).toContain('<strong>this</strong>')
    expect(read).toContain('href="https://x.test"')
    expect(shown(doc)).toBe('Claim1.\n\n1 See the docs and this part.')
  })
  test('hold a link that can be followed', () => {
    expect(linked(doc)).toContain('the docs')
  })
})
describe('the words of a definition', () => {
  test('are drawn with their bold, as the reading view draws them', () => {
    const doc = 'Term\n: has **bold** words'
    expect(renderMarkdown(doc)).toContain('<strong>bold</strong>')
    expect(shown(doc)).toBe('Term\n has bold words')
  })
})
