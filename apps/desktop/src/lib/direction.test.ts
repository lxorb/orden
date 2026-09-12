import { describe, expect, test } from 'vitest'
import { directionOf, factorOf, isolated, RIGHT_TO_LEFT } from './direction'
import { LANGUAGES } from './i18n.svelte'

describe('which way a language reads', () => {
  test('the four that read right to left', () => {
    expect(directionOf('ar')).toBe('rtl')
    expect(directionOf('fa')).toBe('rtl')
    expect(directionOf('ps')).toBe('rtl')
    expect(directionOf('ur')).toBe('rtl')
  })

  test('everything else reads left to right', () => {
    for (const language of LANGUAGES) {
      if (RIGHT_TO_LEFT.includes(language.id)) continue
      expect(directionOf(language.id)).toBe('ltr')
    }
  })

  test('a region or a script does not change the answer', () => {
    expect(directionOf('ar-EG')).toBe('rtl')
    expect(directionOf('AR')).toBe('rtl')
    expect(directionOf('pt-BR')).toBe('ltr')
    expect(directionOf('zh-Hant-HK')).toBe('ltr')
  })

  test('nothing at all reads the way most of the world does', () => {
    expect(directionOf('')).toBe('ltr')
    expect(directionOf('system')).toBe('ltr')
  })

  test('every language named here is a language the app has', () => {
    const known = new Set(LANGUAGES.map((language) => language.id))
    for (const id of RIGHT_TO_LEFT) expect(known.has(id)).toBe(true)
  })
})

describe('a name inside a sentence', () => {
  const FSI = '\u2068'
  const PDI = '\u2069'
  const arabic = 'خطة'

  test('a name the other way round is wrapped in an isolate', () => {
    expect(isolated(arabic, 'ltr')).toBe(`${FSI}${arabic}${PDI}`)
    expect(isolated('Note.md', 'rtl')).toBe(`${FSI}Note.md${PDI}`)
  })

  test('a name that reads the sentence’s way is left exactly as it came', () => {
    expect(isolated('Note.md', 'ltr')).toBe('Note.md')
    expect(isolated(arabic, 'rtl')).toBe(arabic)
    expect(isolated('', 'ltr')).toBe('')
    expect(isolated('12', 'rtl')).toBe('12')
  })
})

describe('which way round a movement goes', () => {
  test('forward is to the right, or to the left', () => {
    expect(factorOf('ltr')).toBe(1)
    expect(factorOf('rtl')).toBe(-1)
  })
})
