import { describe, expect, test } from 'vitest'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'
import { type Dictionary, LANGUAGES } from './i18n.svelte'
import { LABELS } from './kinds'
import { PROBLEMS } from './problems'

const TRANSLATIONS: [string, Dictionary][] = [
  ['de', de],
  ['gsw', gsw],
  ['fr', fr],
  ['ja', ja],
]

/** The same substitution `t()` performs, without the reactive wrapper. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}

describe.each(TRANSLATIONS)('the %s dictionary', (language, dictionary) => {
  test('has a translation for every entry', () => {
    for (const [english, translated] of Object.entries(dictionary)) {
      expect(translated.trim(), english).not.toBe('')
    }
  })

  test('translates most of what it holds', () => {
    // A few words carry over unchanged - Link, Page - so an entry that matches
    // its key is fine; a dictionary full of them is not a dictionary.
    const changed = Object.entries(dictionary).filter(([english, one]) => english !== one)
    expect(changed.length).toBeGreaterThan(Object.keys(dictionary).length * 0.9)
  })

  test('keeps every placeholder the English string uses', () => {
    for (const [english, translated] of Object.entries(dictionary)) {
      const wanted = [...english.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
      const got = [...translated.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

      expect(got, english).toEqual(wanted)
    }
  })

  test('survived the file encoding', () => {
    for (const translated of Object.values(dictionary)) {
      expect(translated).not.toMatch(/Ã|â€| Â/)
    }
  })

  test('covers the same ground as the German one', () => {
    const missing = Object.keys(de).filter((key) => !(key in dictionary))
    expect(missing, language).toEqual([])
  })

  test('says every sentence the extension can show', () => {
    for (const sentence of Object.values(PROBLEMS)) {
      expect(dictionary[sentence], `${language}: ${sentence}`).toBeDefined()
    }
  })

  test('names all three clips', () => {
    for (const label of Object.values(LABELS)) {
      expect(dictionary[label], `${language}: ${label}`).toBeDefined()
    }
  })

  test('writes no em dashes', () => {
    for (const translated of Object.values(dictionary)) {
      expect(translated).not.toContain(String.fromCharCode(0x2014))
    }
  })
})

describe('the dictionaries between them', () => {
  test('spell the words the app already spells the way the app spells them', () => {
    expect(de.Save).toBe('Speichern')
    expect(fr.Save).toBe('Enregistrer')
    expect(ja.Save).toBe('保存')
    expect(gsw.Space).toBe('Ablag')
  })

  test('Swiss German never uses an eszett', () => {
    for (const [english, swiss] of Object.entries(gsw)) {
      expect(swiss, english).not.toContain('ß')
    }
  })

  test('Swiss German is the Zurich dialect, not the Bernese one', () => {
    for (const [english, swiss] of Object.entries(gsw)) {
      expect(swiss, english).not.toMatch(/\bnid\b/)
      expect(swiss, english).not.toMatch(/\bverlah\b/)
    }
  })
})

describe('the English the dictionaries are keyed by', () => {
  test('writes no em dashes either', () => {
    for (const english of Object.keys(de)) {
      expect(english).not.toContain(String.fromCharCode(0x2014))
    }
  })

  test('ends every sentence about a failure with a full stop', () => {
    for (const sentence of Object.values(PROBLEMS)) {
      expect(sentence.endsWith('.'), sentence).toBe(true)
    }
  })
})

describe('the language list', () => {
  test('offers the system default first', () => {
    expect(LANGUAGES[0].id).toBe('system')
  })

  test('has a dictionary for every language it offers', () => {
    const named = LANGUAGES.map((language) => language.id).filter(
      (id) => id !== 'system' && id !== 'en',
    )

    expect([...named].sort()).toEqual(TRANSLATIONS.map(([id]) => id).sort())
  })
})

describe('filling in placeholders', () => {
  test('substitutes what it is given', () => {
    expect(fill('Resend in {seconds}s', { seconds: 12 })).toBe('Resend in 12s')
  })

  test('leaves an unknown placeholder alone', () => {
    expect(fill('{a} and {b}', { a: '1' })).toBe('1 and {b}')
  })
})
