import { describe, expect, test } from 'vitest'
import { isSpellWord, knownRanges, LONGEST_WORD } from './spelling'

const quiet = (text: string, words: readonly string[]) =>
  knownRanges(text, words).map((one) => text.slice(one.from, one.to))

describe('which words a dictionary may hold', () => {
  test('a word of a language, however it is spelled', () => {
    for (const word of ['orden', 'Obsidian', 'CodeMirror', 'naïve', "don't", 'l’an', 'a1', 'x_y']) {
      expect(isSpellWord(word), word).toBe(true)
    }
  })

  test('and never a phrase, an empty string, or anything a pattern would read', () => {
    for (const word of [
      '',
      ' ',
      'two words',
      '.*',
      'a|b',
      '(x)',
      '-lead',
      'a'.repeat(LONGEST_WORD + 1),
    ]) {
      expect(isSpellWord(word), JSON.stringify(word)).toBe(false)
    }
  })
})

describe('the checker turned off over a known word', () => {
  test('wherever it appears', () => {
    expect(quiet('orden and orden again', ['orden'])).toEqual(['orden', 'orden'])
  })

  test('whatever case it was written in', () => {
    expect(quiet('Orden and ORDEN', ['orden'])).toEqual(['Orden', 'ORDEN'])
  })

  test('but never inside a longer word', () => {
    expect(quiet('ordenly', ['orden'])).toEqual([])
    expect(quiet('unorden', ['orden'])).toEqual([])
  })

  test('and an accent or an apostrophe is part of a word, not a boundary', () => {
    expect(quiet('naïve', ['naïve'])).toEqual(['naïve'])
    expect(quiet('naïveté', ['naïve'])).toEqual([])
  })

  test('one word out of a list of them', () => {
    expect(quiet('orden and Zug and Bern', ['zug', 'bern'])).toEqual(['Zug', 'Bern'])
  })

  test('nothing at all with an empty list', () => {
    expect(quiet('orden', [])).toEqual([])
  })

  test('and nothing for a word that is not a word', () => {
    expect(quiet('anything at all', ['.*'])).toEqual([])
    expect(quiet('a|b', ['a|b'])).toEqual([])
  })

  test('the ranges come back in order, which a decoration set insists on', () => {
    const found = knownRanges('orden orden orden', ['orden'])
    expect(found.map((one) => one.from)).toEqual([0, 6, 12])
  })
})
