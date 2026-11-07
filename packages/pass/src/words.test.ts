import { describe, expect, it } from 'vitest'
import { WORDS } from './words'

describe('WORDS', () => {
  it('is the EFF large list', () => {
    expect(WORDS).toHaveLength(7776)
    expect(new Set(WORDS).size).toBe(7776)
    for (const word of WORDS) expect(word).toMatch(/^[a-z-]+$/)
    expect(WORDS[0]).toBe('abacus')
    expect(WORDS.at(-1)).toBe('zoom')
  })
})
