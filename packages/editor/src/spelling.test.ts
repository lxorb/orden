import { describe, expect, test } from 'vitest'
import { isSpellWord, knownRanges, LONGEST_WORD } from './spelling'

/** The words the checker would be turned off over. */
const quiet = (text: string, words: readonly string[]) =>
  knownRanges(text, words).map((one) => text.slice(one.from, one.to))

describe('which words a dictionary may hold', () => {
  test('a word of a language, however it is spelled', () => {
    for (const word of ['nib', 'Obsidian', 'CodeMirror', 'naïve', "don't", 'l’an', 'a1', 'x_y']) {
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
    expect(quiet('nib and nib again', ['nib'])).toEqual(['nib', 'nib'])
  })

  test('whatever case it was written in', () => {
    expect(quiet('Nib and NIB', ['nib'])).toEqual(['Nib', 'NIB'])
  })

  test('but never inside a longer word', () => {
    // Otherwise adding "nib" would quieten "nibble", and a real typo would be
    // hidden by a word that merely starts the same way.
    expect(quiet('nibble', ['nib'])).toEqual([])
    expect(quiet('unnib', ['nib'])).toEqual([])
  })

  test('and an accent or an apostrophe is part of a word, not a boundary', () => {
    expect(quiet('naïve', ['naïve'])).toEqual(['naïve'])
    expect(quiet('naïveté', ['naïve'])).toEqual([])
  })

  test('one word out of a list of them', () => {
    expect(quiet('nib and Zug and Bern', ['zug', 'bern'])).toEqual(['Zug', 'Bern'])
  })

  test('nothing at all with an empty list', () => {
    expect(quiet('nib', [])).toEqual([])
  })

  test('and nothing for a word that is not a word', () => {
    // A list that arrived from an older build or from the account cannot put a
    // pattern into the one this builds.
    expect(quiet('anything at all', ['.*'])).toEqual([])
    expect(quiet('a|b', ['a|b'])).toEqual([])
  })

  test('the ranges come back in order, which a decoration set insists on', () => {
    const found = knownRanges('nib nib nib', ['nib'])
    expect(found.map((one) => one.from)).toEqual([0, 4, 8])
  })
})
