import { describe, expect, test } from 'vitest'
import lines from './fixtures/plain-lines.json'
import { renderMarkdown } from './index'

/** A line of somebody's plain words, as an import writes it into a note: escaped so it
 *  reads back as the words and nothing else. The Apple Notes reader in the crate writes
 *  exactly these (`apple_text.rs`), and this is what says they are right: each renders
 *  as one paragraph holding the words, with no mark, block or tag made of them. */
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
