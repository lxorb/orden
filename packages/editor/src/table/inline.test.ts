import { describe, expect, test } from 'vitest'
import { type Inline, parseInline } from './inline'

function html(source: string): string {
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
describe('a table cell', () => {
  test.each([
    ['**Orden**', '<strong>Orden</strong>'],
    ['*maybe*', '<em>maybe</em>'],
    ['`pnpm dev`', '<code>pnpm dev</code>'],
    ['~~gone~~', '<del>gone</del>'],
    ['use **Orden** daily', 'use <strong>Orden</strong> daily'],
    ['**a** and *b*', '<strong>a</strong> and <em>b</em>'],
    ['**bold *and* both**', '<strong>bold <em>and</em> both</strong>'],
    ['just words', 'just words'],
    ['✅', '✅'],
    ['', ''],
    ['a \\| b', 'a | b'],
    ['`a \\| b`', '<code>a | b</code>'],
    ['`x` and \\| and `y \\| z`', '<code>x</code> and | and <code>y | z</code>'],
    ['`C:\\temp`', '<code>C:\\temp</code>'],
  ])('%j', (input, wanted) => expect(html(input)).toEqual(wanted))
  test('keeps text that only looks like markup as text', () => {
    expect(parseInline('a < b & c')).toEqual([{ text: 'a < b & c' }])
  })
})
describe('links in a cell', () => {
  test.each([
    ['[Orden](https://orden.so)', '<a href="https://orden.so">Orden</a>'],
    ['[tap](javascript:alert(1))', '<a>tap</a>'],
  ])('%j', (input, wanted) => expect(html(input)).toEqual(wanted))
})
describe('a wikilink in a cell', () => {
  test.each([
    ['[[Note]]', [{ text: 'Note' }]],
    ['see [[Note\\|alias]] here', [{ text: 'see ' }, { text: 'alias' }, { text: ' here' }]],
  ])('%j', (input, wanted) => expect(parseInline(input)).toEqual(wanted))
})
