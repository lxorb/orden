import { describe, expect, test } from 'vitest'
import { fold, undrawable } from './firmware'
import { drawsScript, SCRIPTS, scriptsNotDrawn } from './scripts'

describe('the scripts the firmware draws', () => {
  test.each(SCRIPTS.map((one) => [one.code, one] as const))('%s is measured, not assumed', (_code, script) => {
    const missing = undrawable(script.sample)

    if (script.draws) {
      expect(missing, `${script.name}: ${script.sample}`).toBe(0)
      expect(fold(script.sample)).toBe(script.sample.normalize('NFC'))
    } else {
      expect(missing, `${script.name}: ${script.sample}`).toBeGreaterThan(0.3)
      expect(fold(script.sample)).toContain('□')
    }
  })

  test('says what the font is documented to carry, and no more', () => {
    const drawn = SCRIPTS.filter((one) => one.draws).map((one) => one.code)

    expect(drawn).toEqual(['Latn', 'Cyrl', 'Grek', 'Hans', 'Hant', 'Jpan', 'Kore'])
    expect(scriptsNotDrawn().map((one) => one.code)).toEqual([
      'Deva',
      'Beng',
      'Guru',
      'Gujr',
      'Taml',
      'Telu',
      'Knda',
      'Mlym',
      'Arab',
      'Thai',
      'Mymr',
      'Ethi',
    ])
  })

  test('and no language is filed under two scripts', () => {
    const seen = new Set<string>()
    const twice: string[] = []

    for (const one of SCRIPTS.flatMap((script) => script.languages)) {
      if (seen.has(one)) twice.push(one)
      seen.add(one)
    }

    expect(twice).toEqual([])
  })
})

test.each<[unknown, ...Parameters<typeof drawsScript>]>([
  [true, 'Latn'],
  [true, 'Cyrl'],
  [true, 'Jpan'],
  [false, 'Deva'],
  [false, 'Arab'],
  [false, 'Ethi'],
  [true, undefined],
  [true, ''],
  [true, 'Runr'],
])('%j from %j', (expected, ...args) => {
  expect(drawsScript(...args)).toBe(expected)
})
