import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'
import { asWords } from './words'

describe('somebody else’s words in a note', () => {
  test('cannot open a tag; even behind a backslash of their own; and keep a bracket that was arithmetic; and are otherwise left as they were written', () => {
    expect(asWords('Fine <img src=x onerror=alert(1)>')).toBe('Fine \\<img src=x onerror=alert(1)>')
    expect(asWords('</div>')).toBe('\\</div>')
    expect(asWords('<!-- hidden -->')).toBe('\\<!-- hidden -->')
    expect(asWords('<?php')).toBe('\\<?php')
    for (const text of ['\\<img src=x>', 'a \\\\<style>x</style>', '\\</div>']) {
      const html = renderMarkdown(asWords(text))
      expect(html, text).not.toMatch(/<(img|style|\/div)/)
    }
    expect(asWords('a \\ b')).toBe('a \\ b')
    expect(asWords('a < b and 3<4')).toBe('a < b and 3<4')
    expect(asWords('*Plans* for #2026: 50% done')).toBe('*Plans* for #2026: 50% done')
    expect(asWords('')).toBe('')
  })
})
