import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildDecorations } from './live-preview/decorate'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { type Inline, parseInline } from './table/inline'
import { parsed } from '../test/parsed'

const PARK = '\n\nx'

function linkMarks(doc: string) {
  const full = doc + PARK
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const out: { text: string; href?: string }[] = []
  buildDecorations(state).decorations.between(0, full.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> }
    if (!spec.class?.split(' ').includes('orden-link')) return
    const href = spec.attributes?.['data-href']
    out.push({ text: full.slice(from, to), ...(href ? { href } : {}) })
  })
  return out
}

function cell(source: string): string {
  const show = (nodes: Inline[]): string =>
    nodes
      .map((node) => {
        if ('text' in node) return node.text
        const attribute = node.href ? ` href="${node.href}"` : ''
        return `<${node.tag}${attribute}>${show(node.children)}</${node.tag}>`
      })
      .join('')
  return show(parseInline(source))
}

describe('a www address with an at sign in its path', () => {
  test('in a table cell opens the page, not a mail', () => {
    expect(renderMarkdown('see www.youtube.com/@mkbhd now')).toContain('href="http://www.youtube.com/@mkbhd"')
    expect(cell('see www.youtube.com/@mkbhd now')).toBe(
      'see <a href="https://www.youtube.com/@mkbhd">www.youtube.com/@mkbhd</a> now',
    )
  })

  test('in the note opens the page, not a mail', () => {
    const doc = 'get www.example.com/@scope/pkg.json here'
    expect(renderMarkdown(doc)).toContain('href="http://www.example.com/@scope/pkg.json"')
    expect(linkMarks(doc)).toEqual([
      {
        text: 'www.example.com/@scope/pkg.json',
        href: 'https://www.example.com/@scope/pkg.json',
      },
    ])
  })
})

describe('a www address with a colon in its path', () => {
  test('in a table cell is still a link', () => {
    expect(linkMarks('read www.example.com/wiki/Help:Contents now')).toEqual([
      {
        text: 'www.example.com/wiki/Help:Contents',
        href: 'https://www.example.com/wiki/Help:Contents',
      },
    ])
    expect(cell('read www.example.com/wiki/Help:Contents now')).toBe(
      'read <a href="https://www.example.com/wiki/Help:Contents">www.example.com/wiki/Help:Contents</a> now',
    )
  })
})

describe('a link written with its address between angle brackets', () => {
  test('in a table cell can be followed, as in the note', () => {
    expect(linkMarks('see [a](<https://x.com/a b>) now')).toEqual([{ text: 'a', href: 'https://x.com/a b' }])
    expect(cell('see [a](<https://x.com/a b>) now')).toBe('see <a href="https://x.com/a b">a</a> now')
  })
})
