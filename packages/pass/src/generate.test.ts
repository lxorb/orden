import { describe, expect, it } from 'vitest'
import type { Random } from './generate'
import {
  DEFAULT_MEMORABLE,
  DEFAULT_RANDOM,
  DIGITS,
  joinedWords,
  LOWER,
  memorablePassword,
  randomPassword,
  secureRandom,
  SEPARATORS,
  SYMBOLS,
  UPPER,
} from './generate'
import { WORDS } from './words'

function seeded(seed: number): Random {
  let state = seed
  return (n) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % n
  }
}

function has(text: string, pool: string): boolean {
  for (const one of text) if (pool.includes(one)) return true
  return false
}

describe('secureRandom', () => {
  it('stays in range and covers it', () => {
    const seen = new Set<number>()
    for (let at = 0; at < 500; at++) {
      const value = secureRandom(7)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(7)
      seen.add(value)
    }
    expect(seen.size).toBe(7)
    expect(secureRandom(1)).toBe(0)
    expect(() => secureRandom(0)).toThrow()
    expect(() => secureRandom(1.5)).toThrow()
  })
})

describe('randomPassword', () => {
  it('holds every chosen class, at the length asked', () => {
    for (let at = 0; at < 200; at++) {
      const password = randomPassword(DEFAULT_RANDOM)
      expect(password).toHaveLength(20)
      expect(has(password, LOWER) && has(password, UPPER)).toBe(true)
      expect(has(password, DIGITS) && has(password, SYMBOLS)).toBe(true)
    }
    for (let at = 0; at < 50; at++) {
      const four = randomPassword({ length: 4, upper: true, digits: true, symbols: true })
      expect(has(four, LOWER) && has(four, UPPER) && has(four, DIGITS) && has(four, SYMBOLS)).toBe(
        true,
      )
    }
  })

  it('leaves out what is not chosen', () => {
    for (let at = 0; at < 100; at++) {
      const password = randomPassword({ length: 30, upper: false, digits: false, symbols: false })
      expect(password).toMatch(new RegExp(`^[${LOWER}]{30}$`))
    }
  })

  it('keeps the length in range', () => {
    expect(randomPassword({ ...DEFAULT_RANDOM, length: 1 })).toHaveLength(4)
    expect(randomPassword({ ...DEFAULT_RANDOM, length: 500 })).toHaveLength(64)
  })

  it('never uses characters that look alike', () => {
    const all = LOWER + UPPER + DIGITS + SYMBOLS
    for (const confusing of 'Il1O0o') expect(all).not.toContain(confusing)
    for (let at = 0; at < 100; at++)
      expect(randomPassword({ ...DEFAULT_RANDOM, length: 64 })).not.toMatch(/[Il1O0o]/)
  })

  it('is decided by the random it is given', () => {
    expect(randomPassword(DEFAULT_RANDOM, seeded(3))).toBe(
      randomPassword(DEFAULT_RANDOM, seeded(3)),
    )
    expect(randomPassword(DEFAULT_RANDOM, seeded(3))).not.toBe(
      randomPassword(DEFAULT_RANDOM, seeded(4)),
    )
  })
})

describe('memorablePassword', () => {
  it('joins capitalised words with one number', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const parts = memorablePassword(DEFAULT_MEMORABLE, WORDS, seeded(seed)).split('-')
      expect(parts).toHaveLength(5)
      for (const part of parts) expect(part).toMatch(/^[A-Z][a-z]*[2-9]?$/)
      expect(parts.filter((part) => /[2-9]$/.test(part))).toHaveLength(1)
    }
  })

  it('shows as many words as asked, whatever word and separator', () => {
    const marks = { hyphen: '-', space: ' ', period: '.', comma: ',', underscore: '_' } as const
    const wrong: string[] = []
    for (const [separator, mark] of Object.entries(marks) as [keyof typeof marks, string][])
      for (const word of WORDS) {
        const rule = { words: 3, separator, capitalize: true, numbers: true }
        const password = memorablePassword(rule, [word], seeded(word.length))
        const parts = password.split(mark).map((part) => part.replace(/[2-9]$/, '').toLowerCase())
        if (parts.join(' ') !== `${word} ${word} ${word}`) wrong.push(password)
      }
    const rule = {
      words: 4,
      separator: 'digitOrSymbol',
      capitalize: false,
      numbers: false,
    } as const
    for (const word of WORDS) {
      const password = memorablePassword(rule, [word], seeded(word.length))
      if (password.split(/[^a-z]/).join(' ') !== `${word} ${word} ${word} ${word}`)
        wrong.push(password)
    }
    expect(wrong).toEqual([])
  })

  it('takes words from the list it is given', () => {
    const password = memorablePassword(
      { words: 3, separator: 'space', capitalize: false, numbers: false },
      ['cat'],
    )
    expect(password).toBe('cat cat cat')
  })

  it('separates as asked', () => {
    const rule = { words: 4, capitalize: false, numbers: false }
    const words = ['w']
    expect(memorablePassword({ ...rule, separator: 'period' }, words)).toBe('w.w.w.w')
    expect(memorablePassword({ ...rule, separator: 'comma' }, words)).toBe('w,w,w,w')
    expect(memorablePassword({ ...rule, separator: 'underscore' }, words)).toBe('w_w_w_w')
    expect(memorablePassword({ ...rule, separator: 'digit' }, words)).toMatch(
      /^w[2-9]w[2-9]w[2-9]w$/,
    )
    for (let at = 0; at < 50; at++)
      expect(memorablePassword({ ...rule, separator: 'digitOrSymbol' }, words)).toMatch(
        /^w[^w]w[^w]w[^w]w$/,
      )
    expect(joinedWords(['a', 'b'], 'none')).toBe('ab')
    expect(SEPARATORS).toHaveLength(7)
  })

  it('keeps the word count in range', () => {
    const rule = { separator: 'hyphen', capitalize: false, numbers: false } as const
    expect(memorablePassword({ ...rule, words: 0 }, ['w'])).toBe('w')
    expect(memorablePassword({ ...rule, words: 40 }, ['w']).split('-')).toHaveLength(10)
  })

  it('is decided by the random it is given', () => {
    expect(memorablePassword(DEFAULT_MEMORABLE, WORDS, seeded(9))).toBe(
      memorablePassword(DEFAULT_MEMORABLE, WORDS, seeded(9)),
    )
  })
})
