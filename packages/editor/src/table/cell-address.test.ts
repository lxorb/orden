import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { type Inline, parseInline } from './inline'

function words(source: string): string {
  const show = (nodes: Inline[]): string =>
    nodes.map((node) => ('text' in node ? node.text : show(node.children))).join('')
  return show(parseInline(source))
}
describe('a drawn table cell holding a web address', () => {
  test('shows a bare address, as the reading view does', () => {
    const table = '| site |\n| - |\n| see https://x.test now |'
    expect(renderMarkdown(table)).toContain('https://x.test</a> now')
    expect(words('see https://x.test now')).toBe('see https://x.test now')
  })
  test('shows a www address', () => {
    expect(words('www.example.com')).toBe('www.example.com')
  })
  test('shows an address written in angle brackets', () => {
    expect(words('<https://x.test>')).toBe('https://x.test')
  })
  test('shows a link whose words are its address', () => {
    expect(words('[https://a.test](https://a.test)')).toBe('https://a.test')
  })
})
