import { describe, expect, test } from 'vitest'
import { asWords } from './words'

describe('somebody else’s words in a note', () => {
  test('cannot open a tag', () => {
    expect(asWords('Fine <img src=x onerror=alert(1)>')).toBe(
      'Fine \\<img src=x onerror=alert(1)>',
    )
    expect(asWords('</div>')).toBe('\\</div>')
    expect(asWords('<!-- hidden -->')).toBe('\\<!-- hidden -->')
    expect(asWords('<?php')).toBe('\\<?php')
  })

  test('and keep a bracket that was arithmetic', () => {
    expect(asWords('a < b and 3<4')).toBe('a < b and 3<4')
  })

  test('and are otherwise left as they were written', () => {
    expect(asWords('*Plans* for #2026: 50% done')).toBe('*Plans* for #2026: 50% done')
    expect(asWords('')).toBe('')
  })
})
