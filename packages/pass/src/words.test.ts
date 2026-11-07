import { describe, expect, it } from 'vitest'
import { DIGITS, SYMBOLS } from './generate'
import { WORDS } from './words'

describe('WORDS', () => {
  it('is the EFF large list without the words that hold a hyphen', () => {
    expect(WORDS).toHaveLength(7772)
    expect(WORDS[0]).toBe('abacus')
    expect(WORDS.at(-1)).toBe('zoom')
  })

  it('holds each word once, in plain lower-case letters', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length)
    expect(WORDS.filter((word) => !/^[a-z]+$/.test(word))).toEqual([])
  })

  it('holds no character any separator can be', () => {
    const separators = ` -.,_${DIGITS}${SYMBOLS}`
    const held = WORDS.filter((word) => Array.from(word).some((one) => separators.includes(one)))
    expect(held).toEqual([])
  })
})
