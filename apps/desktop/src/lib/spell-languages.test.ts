import { describe, expect, test } from 'vitest'
import {
  chosenOf,
  DICTIONARIES,
  dictionaryFor,
  inForce,
  inForceNow,
  toggled,
} from './spell-languages'

/** The dictionaries a note is checked in, several at once (#771). */
describe('the dictionary a language reads in', () => {
  test('is its own where Chromium has one', () => {
    expect(dictionaryFor('de-DE')).toBe('de-DE')
    expect(dictionaryFor('pt-pt')).toBe('pt-PT')
  })

  test('is in the region the machine names, where the app names only the language', () => {
    expect(dictionaryFor('en', ['en-US', 'en'])).toBe('en-US')
    expect(dictionaryFor('en', ['de-DE', 'en-GB'])).toBe('en-GB')
  })

  test('is the first of its language otherwise, and English where there is none', () => {
    expect(dictionaryFor('de-AT')).toBe('de-DE')
    expect(dictionaryFor('ja')).toBe('en-US')
  })
})

describe('the dictionaries in force', () => {
  test('are the ones chosen, several at once', () => {
    expect(inForce(['de-DE', 'en-US'], 'en')).toEqual(['de-DE', 'en-US'])
  })

  test('are the reader’s own language where none was chosen, never nothing', () => {
    expect(inForce([], 'fr', ['fr-CH'])).toEqual(['fr-FR'])
    expect(inForce(['xx-YY'], 'de')).toEqual(['de-DE'])
  })
})

describe('the list as it was stored', () => {
  test('keeps only the dictionaries there are, once each', () => {
    expect(chosenOf(['de-DE', 'de-DE', 'xx', 4, 'en-US'])).toEqual(['de-DE', 'en-US'])
    expect(chosenOf('de-DE')).toEqual([])
  })

  test('names every dictionary by a tag Chromium has', () => {
    for (const one of DICTIONARIES) expect(one.id).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/)
  })
})

describe('what an older build chose', () => {
  /** One dictionary, by a short tag, was `spellLanguage` before there could be several. */
  test('reads as the dictionary its tag names', () => {
    expect(inForceNow(['de'])).toEqual(['de-DE'])
    expect(inForceNow(['de', 'fr-FR'])).toEqual(['de-DE', 'fr-FR'])
  })
})

describe('one dictionary turned on or off', () => {
  test('keeps the others, in the list’s own order', () => {
    expect(toggled(['fr-FR'], 'de-DE', true)).toEqual(['de-DE', 'fr-FR'])
    expect(toggled(['de-DE', 'fr-FR'], 'fr-FR', false)).toEqual(['de-DE'])
  })

  test('never turns the last one off, and says when nothing changes', () => {
    expect(toggled(['de-DE'], 'de-DE', false)).toBeNull()
    expect(toggled(['de-DE'], 'de-DE', true)).toBeNull()
  })
})
