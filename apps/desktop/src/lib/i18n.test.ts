import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { englishLabel, LABEL_KEYS } from '@nib/editor'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'
import { type Dictionary, i18n, LANGUAGES } from './i18n.svelte'

/** The substitution `t()` performs, on the real thing: a dictionary is not
 *  needed to fill a template in, and a second copy of the rule here would be a
 *  second rule to keep in step. */
const fill = (template: string, values: Record<string, string | number>): string =>
  i18n.t(template, values)

const TRANSLATIONS: [string, Dictionary][] = [
  ['de', de],
  ['gsw', gsw],
  ['fr', fr],
  ['ja', ja],
]

/** Every English string the app asks for, read off the source rather than
 *  written down: a list of them would go stale the first time somebody added a
 *  row, and a row nobody translated reads as English in an app somebody set to
 *  their own language.
 *
 *  Three shapes carry one: `t()` translates on the spot, `key()` marks a string
 *  something further along translates, and `message()`'s second argument is the
 *  sentence a failure falls back to. */
const SOURCE = fileURLToPath(new URL('..', import.meta.url))

const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`
const CALLS = [
  new RegExp(String.raw`(?<![.\w$])t\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])key\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])message\(\s*[^,()]*,\s*${LITERAL}`, 'g'),
]

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    // The dictionaries are the answer, not the question.
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, found)
    } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

/** Each string, and the first place it is asked for, so a failure says where
 *  to look. */
function stringsAsked(): Map<string, string> {
  const asked = new Map<string, string>()

  for (const path of sourceFiles(SOURCE)) {
    const text = readFileSync(path, 'utf8')

    for (const pattern of CALLS) {
      for (const match of text.matchAll(pattern)) {
        const literal = (match[1] ?? '').replace(/\\(.)/g, (_whole, escaped: string) =>
          escaped === 'n' ? '\n' : escaped,
        )
        const line = text.slice(0, match.index).split('\n').length
        if (!asked.has(literal)) asked.set(literal, `${path.slice(SOURCE.length)}:${line}`)
      }
    }
  }

  return asked
}

// Read once: the whole source tree is work no single test should be charged for.
const ASKED = stringsAsked()

describe.each(TRANSLATIONS)('the %s dictionary', (language, dictionary) => {
  test('has a translation for every entry', () => {
    // A few words carry over unchanged - Code, Name, Export - so an entry that
    // matches its key is fine; an empty one never is.
    for (const [english, translated] of Object.entries(dictionary)) {
      expect(translated.trim(), english).not.toBe('')
    }
  })

  test('translates most of what it holds', () => {
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
    // A mangled UTF-8 round trip shows up as these sequences.
    for (const translated of Object.values(dictionary)) {
      expect(translated).not.toMatch(/Ã|â€| Â/)
    }
  })

  test('covers the same ground as the German one', () => {
    const missing = Object.keys(de).filter((key) => !(key in dictionary))
    expect(missing, language).toEqual([])
  })

  /** The other way round, so no dictionary carries a row of its own that the
   *  three beside it have never heard of. */
  test('holds nothing the German one does not', () => {
    const extra = Object.keys(dictionary).filter((key) => !(key in de))
    expect(extra, language).toEqual([])
  })

  /** The check the four of them exist for. A string the app asks for and no
   *  dictionary holds comes out in English, which is the one thing choosing a
   *  language is supposed to prevent. */
  test('translates every string the app asks for', () => {
    const missing = [...ASKED]
      .filter(([text]) => !(text in dictionary))
      .map(([text, where]) => `${where}: ${JSON.stringify(text)}`)

    expect(missing, language).toEqual([])
  })

  test('translates every label the editor shows', () => {
    for (const key of LABEL_KEYS) {
      expect(dictionary[englishLabel(key)], `${language}: ${key}`).toBeDefined()
    }
  })

  test('writes no em dashes', () => {
    for (const translated of Object.values(dictionary)) {
      expect(translated).not.toContain(String.fromCharCode(0x2014))
    }
  })
})

describe('the dictionaries between them', () => {
  test('keep their own spelling', () => {
    expect(de.Delete).toBe('Löschen')
    expect(fr.Delete).toBe('Supprimer')
    expect(ja.Delete).toBe('削除')
  })

  /** The other side of the Swiss rule: German does write an eszett, and half a
   *  dictionary spelling it the Swiss way is one dictionary with two spellings
   *  in it. `schließen` and `Größe` are already there. */
  test('German writes an eszett where German has one', () => {
    for (const [english, german] of Object.entries(de)) {
      expect(german, english).not.toMatch(/gross|grösse|strasse|heiss/i)
    }
  })

  test('Swiss German never uses an eszett', () => {
    for (const [english, swiss] of Object.entries(gsw)) {
      expect(swiss, english).not.toContain('ß')
    }
  })

  test('Swiss German is the Zurich dialect, not the Bernese one', () => {
    // `nid`, `lah` and `verlah` are Bernese; Zurich says `nöd`, `laa` and
    // `verlaa`. Whole words only, so an innocent word containing them is left
    // alone.
    for (const [english, swiss] of Object.entries(gsw)) {
      expect(swiss, english).not.toMatch(/\bnid\b/)
      expect(swiss, english).not.toMatch(/\blah\b/i)
      expect(swiss, english).not.toMatch(/\bverlah\b/)
    }
  })

  /** Swiss German written as German with the odd vowel changed is what the
   *  dictionary is there not to be. These three words are the giveaway, and no
   *  dialect writes any of them. */
  test('Swiss German is not German', () => {
    for (const [english, swiss] of Object.entries(gsw)) {
      expect(swiss, english).not.toMatch(/\bnicht\b/i)
      expect(swiss, english).not.toMatch(/\bkeine?\b/i)
      expect(swiss, english).not.toMatch(/\bist\b/i)
    }
  })

  /** French elides with a typographic apostrophe, the one the English strings
   *  already use in `Don’t save`. Two shapes of it in one panel is two fonts of
   *  it on one screen. */
  test('French elides with one apostrophe throughout', () => {
    for (const [english, french] of Object.entries(fr)) {
      expect(french, english).not.toContain("'")
    }
  })

  /** Japanese punctuation is full width. A question asked with an ASCII mark
   *  sits half a character narrow beside the sentence it ends. */
  test('Japanese asks its questions with a full-width mark', () => {
    for (const [english, japanese] of Object.entries(ja)) {
      expect(japanese, english).not.toMatch(/[?!]/)
      if (english.endsWith('?')) expect(japanese, english).toMatch(/？$/)
    }
  })
})

describe('filling in placeholders', () => {
  test('substitutes what it is given', () => {
    expect(fill('Undo deleting {name}', { name: 'Note.md' })).toBe('Undo deleting Note.md')
  })

  test('leaves an unknown placeholder alone', () => {
    expect(fill('{a} and {b}', { a: '1' })).toBe('1 and {b}')
  })

  test('takes numbers', () => {
    expect(fill('Digit {number}', { number: 3 })).toBe('Digit 3')
  })

  /** Only what was handed over. Every object inherits `toString` and
   *  `constructor`, and reading a placeholder off the prototype would put the
   *  source of a function on screen. */
  test('reads nothing an object merely inherits', () => {
    expect(fill('{toString} {constructor}', { name: 'x' })).toBe('{toString} {constructor}')
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

    expect(named.sort()).toEqual(TRANSLATIONS.map(([id]) => id).sort())
  })
})
