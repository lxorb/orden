import { describe, expect, test } from 'vitest'
import lines from './fixtures/plain-lines.json'
import { renderMarkdown } from './index'

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' }

function said(html: string): string {
  return html.replace(/&(?:lt|gt|amp|quot);/g, (one) => ENTITIES[one] ?? one)
}

describe('a line of plain words, escaped', () => {
  test.each(lines)('$words', ({ words, markdown }) => {
    const html = renderMarkdown(markdown).trim()
    expect(html.startsWith('<p>') && html.endsWith('</p>')).toBe(true)
    const inside = html.slice('<p>'.length, -'</p>'.length)
    expect(inside).not.toContain('<')
    expect(said(inside)).toBe(words)
  })
})
