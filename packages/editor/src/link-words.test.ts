import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildDecorations } from './live-preview/decorate'
import { footnoteAt } from './live-preview/footnotes'
import { imageOfNode } from './live-preview/image'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function stateOf(doc: string) {
  const full = `${doc}\n\nx`
  return parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function shown(doc: string): string {
  const state = stateOf(doc)
  const full = state.doc.toString()
  let out = ''
  let at = 0
  buildDecorations(state).atomic.between(0, full.length, (from, to) => {
    out += full.slice(at, from)
    at = to
  })
  return out + full.slice(at, full.length - 3)
}

function hrefs(doc: string): string[] {
  const state = stateOf(doc)
  const out: string[] = []
  buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
    const href = (value.spec.attributes as Record<string, string> | undefined)?.['data-href']
    if (href) out.push(href)
  })
  return out
}

describe('a link whose words are a web address', () => {
  test('shows the address, as the reading view does', () => {
    const doc = '[https://example.com](https://example.com)'
    expect(renderMarkdown(doc)).toContain('>https://example.com</a>')
    expect(shown(doc)).toBe('https://example.com')
  })

  test('shows a www address written as its words', () => {
    expect(shown('[www.example.com](https://www.example.com)')).toBe('www.example.com')
  })

  test('keeps the address among other words', () => {
    expect(shown('[Visit www.example.com now](https://example.com)')).toBe('Visit www.example.com now')
  })

  test('opens the address it points to, not the one in its words', () => {
    expect(hrefs('[Visit www.example.com now](https://example.com)')).toEqual(['https://example.com'])
  })

  test('in brackets with no address after them stays as typed', () => {
    expect(shown('See the docs [https://example.com/docs].')).toBe('See the docs [https://example.com/docs].')
  })
})

describe('a footnote mark right after an exclamation mark', () => {
  const doc = 'That is great![^1]\n\n[^1]: The note.'

  test('keeps the exclamation mark and shows the footnote number', () => {
    expect(renderMarkdown(doc)).toContain('great!<sup class="footnote-ref"')
    expect(shown(doc)).toBe('That is great!1\n\n1 The note.')
  })

  test('is a footnote mark that can be followed', () => {
    const state = stateOf(doc)
    expect(footnoteAt(state, doc.indexOf('[^1]') + 2)?.kind).toBe('ref')
  })
})

describe('a picture whose description holds a web address', () => {
  test('loads the picture it points to, not the address in its words', () => {
    const doc = '![Screenshot of https://example.com](shot.png)'
    expect(renderMarkdown(doc)).toContain('src="shot.png"')
    const state = stateOf(doc)
    const node = syntaxTree(state).resolveInner(1, 1)
    let image = null
    for (let at: typeof node | null = node; at; at = at.parent) {
      if (at.name === 'Image') image = imageOfNode(state, at)
    }
    expect(image?.src).toBe('shot.png')
  })
})
