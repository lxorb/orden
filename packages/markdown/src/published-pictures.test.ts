import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'

const RESIZED =
  'Before\n\n<img src="https://example.com/cat.png" alt="Cat" style="zoom:50%;" />\n\nAfter\n'

describe('a picture resized in the editor, read where HTML is not trusted', () => {
  test('a published page or shared space draws it as a picture', () => {
    const html = renderMarkdown(RESIZED, { escapeHtml: true })
    expect(html).toMatch(/<img\b[^>]*\ssrc="https:\/\/example\.com\/cat\.png"/)
  })

  test('a published page or shared space does not show its tag as words', () => {
    const html = renderMarkdown(RESIZED, { escapeHtml: true })
    expect(html).not.toContain('&lt;img')
  })
})

describe('a picture tag where HTML is not trusted only keeps what a picture needs', () => {
  test('a script address stays words', () => {
    const html = renderMarkdown('<img src="javascript:alert(1)" />\n', { escapeHtml: true })
    expect(html).not.toMatch(/<img\b/)
  })

  test('a tag with a handler stays words', () => {
    const html = renderMarkdown('<img src="cat.png" onerror="alert(1)" />\n', { escapeHtml: true })
    expect(html).not.toMatch(/<img\b/)
  })

  test('a tag with any other style stays words', () => {
    const html = renderMarkdown('<img src="cat.png" style="zoom:50%; background:url(x)" />\n', {
      escapeHtml: true,
    })
    expect(html).not.toMatch(/<img\b/)
  })

  test('a tag written twice over the same attribute stays words', () => {
    const html = renderMarkdown('<img src="cat.png" src="javascript:alert(1)" />\n', {
      escapeHtml: true,
    })
    expect(html).not.toMatch(/<img\b/)
  })

  test('words around the tag are still escaped', () => {
    const html = renderMarkdown('<img src="cat.png" /><b>bold</b>\n', { escapeHtml: true })
    expect(html).toContain('&lt;b&gt;')
  })
})
