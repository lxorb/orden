// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { htmlToMarkdown } from '@orden/markdown/from-html'

function readBack(html: string): string {
  return renderMarkdown(htmlToMarkdown(html))
}
describe('a pasted superscript or subscript holding a space', () => {
  test('a power with spaces still reads as superscript, with no carets left showing', () => {
    const shown = readBack('<p>2<sup>n - 1</sup> ways</p>')
    expect(shown).toContain('<sup>n - 1</sup>')
    expect(shown).not.toContain('^')
  })
  test('a subscript with a space still reads as subscript, with no tildes left showing', () => {
    const shown = readBack('<p>x<sub>i j</sub> entry</p>')
    expect(shown).toContain('<sub>i j</sub>')
    expect(shown).not.toContain('~')
  })
  test('a clipped encyclopedia note reference keeps its superscript', () => {
    const shown = readBack('<p>Text<sup class="reference"><a href="#cite_note-a">[note 1]</a></sup></p>')
    expect(shown).toMatch(/<sup><a href="#cite_note-a">\[note 1\]<\/a><\/sup>/)
    expect(shown).not.toContain('^')
  })
})
