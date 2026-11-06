import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { inLanguageOrder } from '@orden/markdown/language-order'
import { englishLabel, LABEL_KEYS } from '@orden/editor'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'
import { yue } from '../locales/yue'
import { zhHantHK } from '../locales/zh-Hant-HK'
import {
  CATALOGUE_IDS,
  catalogueFor,
  type Dictionary,
  type Forms,
  i18n,
  LANGUAGES,
  message,
  preferredCatalogue,
} from './i18n.svelte'

const fill = (template: string, values: Record<string, string | number>): string =>
  i18n.t(template, values)

const FSI = '\u2068'
const PDI = '\u2069'

const LOADED = import.meta.glob<Record<string, unknown>>('../locales/*.ts', { eager: true })

function catalogueIn(module: Record<string, unknown>): Dictionary {
  const found = Object.values(module).find((one) => typeof one === 'object' && one !== null)
  if (!found) throw new Error('a locale file exports no catalogue')

  return found as Dictionary
}

const CATALOGUES: [string, Dictionary][] = Object.entries(LOADED)
  .map(([path, module]): [string, Dictionary] => [
    /([^/]+)\.ts$/.exec(path)?.[1] ?? path,
    catalogueIn(module),
  ])
  .sort(([one], [two]) => one.localeCompare(two))

const REFERENCE = Object.keys(de)

const COUNTED = Object.entries(de)
  .filter(([, value]) => typeof value !== 'string')
  .map(([english]) => english)

const SOURCE = fileURLToPath(new URL('..', import.meta.url))

const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`
const CALLS = [
  new RegExp(String.raw`(?<![.\w$])t\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])key\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])message\(\s*[^,()]*,\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])other:\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])panelWord\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])say\(\s*${LITERAL}`, 'g'),
]

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, found)
    } else if (
      /\.(ts|svelte)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      name !== 'i18n.svelte.ts'
    ) {
      found.push(path)
    }
  }

  return found
}

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

const ASKED = stringsAsked()

function glassesWords(): Set<string> {
  const found = new Set<string>()

  for (const path of sourceFiles(join(SOURCE, 'lib', 'even'))) {
    const text = readFileSync(path, 'utf8')
    for (const pattern of CALLS.slice(0, 2)) {
      for (const match of text.matchAll(pattern)) found.add(match[1] ?? '')
    }
  }

  return found
}

const GLASSES = glassesWords()

const WIDE = new RegExp(
  '[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff' +
    '\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]',
)

const columns = (text: string): number =>
  Array.from(text).reduce((sum, one) => sum + (WIDE.test(one) ? 2 : 1), 0)

const PANEL_COLUMNS = 48

const roomFor = (english: string): number =>
  Math.max(PANEL_COLUMNS, Math.ceil(columns(english) * 1.5))

const categoriesOf = (id: string): string[] =>
  new Intl.PluralRules(id).resolvedOptions().pluralCategories.slice().sort()

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()

const forms = (value: string | Forms): string[] =>
  typeof value === 'string' ? [value] : Object.values<string>(value)

function offenders(
  catalogue: Dictionary,
  breaks: (written: string, english: string) => boolean,
): string[] {
  return Object.entries(catalogue).flatMap(([english, value]) =>
    forms(value)
      .filter((written) => breaks(written, english))
      .map((written) => `${english} -> ${written}`),
  )
}

describe('the folder, the list and the loader', () => {
  test('hold the same languages', () => {
    expect(CATALOGUES.map(([id]) => id)).toEqual([...CATALOGUE_IDS].sort())
  })

  test('are what the language list offers', () => {
    const offered = LANGUAGES.map((one) => one.id)
      .filter((id) => id !== 'system' && id !== 'en')
      .sort()

    expect(offered).toEqual([...CATALOGUE_IDS].sort())
  })

  test('are written in the order every language list keeps', () => {
    expect(LANGUAGES.map((one) => one.id)).toEqual(inLanguageOrder(LANGUAGES).map((one) => one.id))
  })

  test('offer the system default first, then the Latin names, then the rest', () => {
    expect(LANGUAGES.map((one) => one.id)).toEqual([
      'system',
      'id',
      'ms',
      'jv',
      'de',
      'en',
      'es',
      'fil',
      'fr',
      'ha',
      'it',
      'sw',
      'pl',
      'pt-BR',
      'pt-PT',
      'gsw',
      'vi',
      'tr',
      'ru',
      'uk',
      'ur',
      'ar',
      'ps',
      'fa',
      'am',
      'mr',
      'hi',
      'bn',
      'pa',
      'gu',
      'ta',
      'te',
      'kn',
      'ml',
      'th',
      'my',
      'ko',
      'ja',
      'zh-Hans',
      'yue',
      'zh-Hant',
      'zh-Hant-HK',
    ])
  })

  test('mark every catalogue nobody has read through', () => {
    const written = ['de', 'gsw', 'fr', 'ja']
    for (const language of LANGUAGES) {
      if (language.id === 'system' || language.id === 'en') continue

      expect(language.machine, language.id).toBe(written.includes(language.id) ? undefined : true)
    }
  })

  test('name every language the way its own speakers write it', () => {
    for (const language of LANGUAGES) {
      expect(language.name.trim(), language.id).not.toBe('')
    }

    const names = LANGUAGES.map((one) => one.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('cover every language with fifty million speakers', () => {
    for (const id of ['zh-Hans', 'zh-Hant', 'zh-Hant-HK', 'pt-BR', 'pt-PT', 'fil', 'ps', 'jv']) {
      expect(CATALOGUE_IDS, id).toContain(id)
    }

    expect(CATALOGUE_IDS.length).toBeGreaterThanOrEqual(40)
  })
})

describe('following the system', () => {
  test('takes the first language the system asks for that it has, English among them', () => {
    expect(preferredCatalogue(['en-US', 'de-DE'])).toBe('en')
    expect(preferredCatalogue(['en-GB', 'fr'])).toBe('en')
    expect(preferredCatalogue(['de-CH', 'en-US'])).toBe('de')
    expect(preferredCatalogue(['tlh', 'gd', 'ja-JP', 'en'])).toBe('ja')
    expect(preferredCatalogue(['tlh'])).toBe('en')
    expect(preferredCatalogue([])).toBe('en')
  })

  test('takes the catalogue a tag names', () => {
    expect(catalogueFor('de')).toBe('de')
    expect(catalogueFor('ja-JP')).toBe('ja')
    expect(catalogueFor('pt-BR')).toBe('pt-BR')
  })

  test('drops a subtag at a time', () => {
    expect(catalogueFor('de-AT')).toBe('de')
    expect(catalogueFor('de-CH')).toBe('de')
    expect(catalogueFor('ar-EG')).toBe('ar')
    expect(catalogueFor('zh-Hans-CN')).toBe('zh-Hans')
  })

  test('reads Chinese by region as well as by script', () => {
    expect(catalogueFor('zh')).toBe('zh-Hans')
    expect(catalogueFor('zh-CN')).toBe('zh-Hans')
    expect(catalogueFor('zh-SG')).toBe('zh-Hans')
    expect(catalogueFor('zh-TW')).toBe('zh-Hant')
    expect(catalogueFor('zh-MO')).toBe('zh-Hant')
    expect(catalogueFor('zh-HK')).toBe('zh-Hant-HK')
  })

  test('and Cantonese as a language of its own', () => {
    expect(catalogueFor('yue')).toBe('yue')
    expect(catalogueFor('yue-HK')).toBe('yue')
    expect(catalogueFor('yue-Hant-HK')).toBe('yue')
    expect(catalogueFor('zh-yue')).toBe('yue')
  })

  test('spells Portuguese the way the region does', () => {
    expect(catalogueFor('pt')).toBe('pt-BR')
    expect(catalogueFor('pt-PT')).toBe('pt-PT')
    expect(catalogueFor('pt-AO')).toBe('pt-PT')
    expect(catalogueFor('pt-MZ')).toBe('pt-PT')
  })

  test('answers an older tag under its current name', () => {
    expect(catalogueFor('tl')).toBe('fil')
    expect(catalogueFor('in')).toBe('id')
    expect(catalogueFor('prs')).toBe('fa')
  })

  test('tidies a tag that has been through storage', () => {
    expect(catalogueFor('ZH-HANT-hk')).toBe('zh-Hant-HK')
    expect(catalogueFor('pt_br')).toBe('pt-BR')
  })

  test('falls back to English rather than to nothing', () => {
    expect(catalogueFor('nb')).toBe('en')
    expect(catalogueFor('en-GB')).toBe('en')
    expect(catalogueFor('')).toBe('en')
    expect(catalogueFor('not a tag at all')).toBe('en')
  })
})

describe.each(CATALOGUES)('the %s catalogue', (language, catalogue) => {
  const categories = categoriesOf(language)

  test('covers every row the reference has', () => {
    const missing = REFERENCE.filter((english) => !(english in catalogue))
    expect(missing, language).toEqual([])
  })

  test('holds nothing the reference does not', () => {
    const extra = Object.keys(catalogue).filter((english) => !REFERENCE.includes(english))
    expect(extra, language).toEqual([])
  })

  test('has something to say for every row', () => {
    const empty = offenders(catalogue, (written) => written.trim() === '')
    expect(empty, language).toEqual([])
  })

  test('translates most of what it holds', () => {
    const changed = Object.entries(catalogue).filter(([english, value]) => value !== english)
    expect(changed.length).toBeGreaterThan(Object.keys(catalogue).length * 0.9)
  })

  test('keeps every placeholder the English string uses', () => {
    const lost = offenders(
      catalogue,
      (written, english) => placeholders(written).join() !== placeholders(english).join(),
    )
    expect(lost, language).toEqual([])
  })

  test('holds the count forms its language has', () => {
    for (const english of COUNTED) {
      const value = catalogue[english]

      if (categories.length === 1) {
        expect(typeof value, `${language}: ${english}`).toBe('string')
        continue
      }

      expect(typeof value, `${language}: ${english}`).toBe('object')
      expect(Object.keys(value as Forms).sort(), `${language}: ${english}`).toEqual(categories)
    }
  })

  test('holds one string for every row a count does not decide', () => {
    const counted = Object.entries(catalogue)
      .filter(([english, value]) => !COUNTED.includes(english) && typeof value !== 'string')
      .map(([english]) => english)

    expect(counted, language).toEqual([])
  })

  test('survived the file encoding', () => {
    const mangled = /[ÃÂ][-¿]|â€/

    expect(
      offenders(catalogue, (written) => mangled.test(written)),
      language,
    ).toEqual([])
  })

  test('writes no em dashes', () => {
    const dash = String.fromCharCode(0x2014)
    expect(
      offenders(catalogue, (written) => written.includes(dash)),
      language,
    ).toEqual([])
  })

  test('carries no direction marks', () => {
    expect(
      offenders(catalogue, (written) => /[‎‏؜‪-‮]/.test(written)),
      language,
    ).toEqual([])
  })

  test('translates every string the app asks for', () => {
    const missing = [...ASKED]
      .filter(([text]) => !(text in catalogue))
      .map(([text, where]) => `${where}: ${JSON.stringify(text)}`)

    expect(missing, language).toEqual([])
  })

  test('keeps the glasses’ own words to a line', () => {
    const long = [...GLASSES]
      .flatMap((english) => {
        const value = catalogue[english]
        if (value === undefined) return []

        const most = roomFor(english)

        return forms(value)
          .filter((written) => columns(written) > most)
          .map((written) => `${columns(written)} columns: ${JSON.stringify(written)}`)
      })
      .sort()

    expect(long, language).toEqual([])
  })

  test('translates every label the editor shows', () => {
    for (const key of LABEL_KEYS) {
      expect(catalogue[englishLabel(key)], `${language}: ${key}`).toBeDefined()
    }
  })
})

describe('the catalogues between them', () => {
  test('keep their own spelling', () => {
    expect(de.Delete).toBe('Löschen')
    expect(fr.Delete).toBe('Supprimer')
    expect(ja.Delete).toBe('削除')
  })

  test('German writes an eszett where German has one', () => {
    for (const [english, value] of Object.entries(de)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/gross|grösse|strasse|heiss/i)
      }
    }
  })

  test('Swiss German never uses an eszett', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) expect(written, english).not.toContain('ß')
    }
  })

  test('Swiss German is the Zurich dialect, not the Bernese one', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/\bnid\b/)
        expect(written, english).not.toMatch(/\blah\b/i)
        expect(written, english).not.toMatch(/\bverlah\b/)
      }
    }
  })

  test('Swiss German is not German', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/\bnicht\b/i)
        expect(written, english).not.toMatch(/\bkeine?\b/i)
        expect(written, english).not.toMatch(/\bist\b/i)
      }
    }
  })

  test('French elides with one apostrophe throughout', () => {
    for (const [english, value] of Object.entries(fr)) {
      for (const written of forms(value)) expect(written, english).not.toContain("'")
    }
  })

  test('Cantonese is written Cantonese, not standard written Chinese', () => {
    const said = Object.values(yue)
      .flatMap((value) => forms(value))
      .join('\n')

    for (const word of ['嘅', '係', '唔', '冇']) {
      expect(said.includes(word), word).toBe(true)
    }
    for (const word of ['呢個', '嗰', '佢', '咗', '睇', '揀', '嘢', '咩']) {
      expect(said.includes(word), word).toBe(true)
    }

    for (const [english, value] of Object.entries(yue)) {
      for (const written of forms(value)) {
        expect(written, english).not.toContain('沒有')
        expect(written, english).not.toContain('這')
        expect(written, english).not.toContain('那')
        expect(written, english).not.toContain('它')
        expect(written, english).not.toContain('的')
        expect(written, english).not.toContain('什麼')
        expect(written, english).not.toContain('無法')
      }
    }
  })

  test('and says something different from Hong Kong’s written Chinese', () => {
    const rows = Object.keys(yue).filter((english) => english in zhHantHK)
    const differ = rows.filter((english) => {
      const one = yue[english]
      const two = zhHantHK[english]
      return JSON.stringify(one) !== JSON.stringify(two)
    })

    expect(differ.length / rows.length).toBeGreaterThan(0.2)
  })

  test('Japanese asks its questions with a full-width mark', () => {
    for (const [english, value] of Object.entries(ja)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/[?!]/)
        if (english.endsWith('?')) expect(written, english).toMatch(/？$/)
      }
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

  test('reads nothing an object merely inherits', () => {
    expect(fill('{toString} {constructor}', { name: 'x' })).toBe('{toString} {constructor}')
  })

  test('a name that reads the other way is kept to itself', () => {
    const arabic = 'خطة.md'
    expect(fill('Undo deleting {name}', { name: arabic })).toBe(
      `Undo deleting ${FSI}${arabic}${PDI}`,
    )

    const was = i18n.choice
    i18n.choice = 'ar'
    try {
      expect(fill('Undo deleting {name}', { name: 'Note.md' })).toBe(
        `Undo deleting ${FSI}Note.md${PDI}`,
      )
      expect(fill('Undo deleting {name}', { name: 'خطة' })).toBe('Undo deleting خطة')
    } finally {
      i18n.choice = was
    }
  })
})

describe('a count', () => {
  test('picks English’s two forms by the rule rather than by a comparison', () => {
    expect(i18n.plural(1, { one: '{count} note', other: '{count} notes' })).toBe('1 note')
    expect(i18n.plural(0, { one: '{count} note', other: '{count} notes' })).toBe('0 notes')
    expect(i18n.plural(7, { one: '{count} note', other: '{count} notes' })).toBe('7 notes')
  })

  test('fills in what else it is given', () => {
    expect(
      i18n.plural(
        2,
        { one: '{name}: {count} note', other: '{name}: {count} notes' },
        { name: 'A' },
      ),
    ).toBe('A: 2 notes')
  })

  test('falls back to the other form', () => {
    expect(i18n.plural(1, { other: '{count} notes' })).toBe('1 notes')
  })

  test('agrees with Intl about what each language needs', () => {
    expect(categoriesOf('ar')).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
    expect(categoriesOf('th')).toEqual(['other'])
    expect(categoriesOf('pl')).toEqual(['few', 'many', 'one', 'other'])
  })
})

describe('dates and numbers', () => {
  test('are written in the app’s language, not the machine’s', () => {
    const at = Date.UTC(2026, 8, 12, 13, 45)
    expect(i18n.when(at, { dateStyle: 'short', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'short', timeZone: 'UTC' }).format(at),
    )
    expect(i18n.amount(12345)).toBe(new Intl.NumberFormat('en').format(12345))
  })

  test('build one formatter per shape', () => {
    expect(i18n.amount(1000)).toBe(i18n.amount(1000))
  })
})

describe('a failure', () => {
  test('says what the server said', () => {
    expect(message(new Error('That address is taken'), 'could not save')).toBe(
      'That address is taken',
    )
  })

  test('says its own sentence for a request that reached nothing', () => {
    for (const engine of [
      'Load failed',
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
    ]) {
      expect(message(new TypeError(engine), 'could not reach the theme store')).toBe(
        'could not reach the theme store',
      )
    }
  })
})
