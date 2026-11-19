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
function state(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
interface Spec {
  class?: string
  attributes?: Record<string, string>
}
function linkMarks(doc: string) {
  const full = doc + PARK
  const out: { text: string; href?: string }[] = []
  buildDecorations(state(full)).decorations.between(0, full.length, (from, to, value) => {
    const spec = value.spec as Spec
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
describe('an email address in the note', () => {
  test('drawn as a link opens a mail, as the reading view does', () => {
    expect(renderMarkdown('write to foo@bar.com today')).toContain('href="mailto:foo@bar.com"')
    expect(linkMarks('write to foo@bar.com today')).toEqual([{ text: 'foo@bar.com', href: 'mailto:foo@bar.com' }])
  })
  test('written between angle brackets opens a mail too', () => {
    expect(linkMarks('<foo@bar.com>')).toEqual([{ text: 'foo@bar.com', href: 'mailto:foo@bar.com' }])
  })
})
describe('a web address inside square brackets that are not a link', () => {
  test('is still drawn as a link that opens', () => {
    expect(linkMarks('see [docs at https://x.com] now')).toEqual([{ text: 'https://x.com', href: 'https://x.com' }])
  })
})
describe('words in square brackets in a drawn table cell', () => {
  test('keep their brackets and are not a link, as in the note and the reading view', () => {
    expect(renderMarkdown('| s |\n| - |\n| [WIP] |')).toContain('<td>[WIP]</td>')
    expect(cell('[WIP]')).toBe('[WIP]')
  })
  test('a ticked box written as [x] keeps its brackets', () => {
    expect(cell('[x] done')).toBe('[x] done')
  })
})
