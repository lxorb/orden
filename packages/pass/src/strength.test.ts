import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORABLE, DEFAULT_RANDOM, memorablePassword, randomPassword } from './generate'
import { COMMON_PASSWORDS, STRENGTH_BITS, strengthOf } from './strength'
import { WORDS } from './words'

const strength = (password: string) => strengthOf(password).strength

describe('strengthOf', () => {
  it('knows the common passwords, also in leet and capitals', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThan(200)
    for (const password of ['password', 'P@ssw0rd', 'PASSWORD1', 'iloveyou', 'L3tm31n', 'Dr4g0n'])
      expect(strength(password)).toBe('vulnerable')
  })

  it('sees through keyboard rows, sequences, repeats and years', () => {
    for (const password of [
      'qwertyuiop',
      'qwertzuiop',
      'azertyuiop',
      'poiuytrewq',
      'asdfghjkl;',
      'abcdefghijklmnop',
      '0123456789',
      'zyxwvutsrq',
      'aaaaaaaaaaaaaaaa',
      'abcabcabcabcabcabc',
      '1990',
      'Summer2024',
      'monkey1990',
    ])
      expect(strength(password)).toBe('vulnerable')
  })

  it('counts words of the word list as words', () => {
    const fourWords = ['battery', 'staple', 'zodiac', 'harvest']
    expect(fourWords.every((word) => WORDS.includes(word))).toBe(true)
    const joined = fourWords.join('')
    expect(strengthOf(joined).bits).toBeCloseTo(4 * Math.log2(WORDS.length), 0)
  })

  it('finds random passwords strong', () => {
    for (let at = 0; at < 20; at++) expect(strength(randomPassword(DEFAULT_RANDOM))).toBe('strong')
    expect(strength('x7#Kq9!mZ2@vR5$w')).toBe('strong')
    expect(strength(memorablePassword(DEFAULT_MEMORABLE, WORDS))).toBe('strong')
  })

  it('puts the middle between the thresholds', () => {
    const { strength: weak, bits } = strengthOf('k9Xm2Qp7z')
    expect(weak).toBe('weak')
    expect(bits).toBeGreaterThanOrEqual(STRENGTH_BITS.weak)
    expect(bits).toBeLessThan(STRENGTH_BITS.strong)
  })

  it('never calls digits alone strong', () => {
    const digits = '83920174658392017465839201746583'
    expect(strengthOf(digits).bits).toBeGreaterThan(STRENGTH_BITS.strong)
    expect(strength(digits)).toBe('weak')
  })

  it('calls nothing vulnerable', () => {
    expect(strengthOf('')).toEqual({ strength: 'vulnerable', bits: 0 })
  })

  it('reads 500 characters in under 50 ms', () => {
    const long = randomPassword({ ...DEFAULT_RANDOM, length: 64 })
      .repeat(8)
      .slice(0, 500)
    const same = 'a'.repeat(500)
    const words = memorablePassword({ ...DEFAULT_MEMORABLE, words: 10 }, WORDS)
      .repeat(10)
      .slice(0, 500)
    strengthOf(long)
    for (const password of [long, same, words]) {
      const start = performance.now()
      strengthOf(password)
      expect(performance.now() - start).toBeLessThan(50)
    }
  })
})
