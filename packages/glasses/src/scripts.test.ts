import { describe, expect, test } from 'vitest'
import { fold, undrawable } from './firmware'
import { drawsScript, SCRIPTS, scriptsNotDrawn } from './scripts'

describe('the scripts the firmware draws', () => {
  test.each(SCRIPTS.map((one) => [one.code, one] as const))(
    '%s is measured, not assumed',
    (_code, script) => {
      const missing = undrawable(script.sample)

      if (script.draws) {
        expect(missing, `${script.name}: ${script.sample}`).toBe(0)
        expect(fold(script.sample)).toBe(script.sample.normalize('NFC'))
      } else {
        expect(missing, `${script.name}: ${script.sample}`).toBeGreaterThan(0.3)
        expect(fold(script.sample)).toContain('□')
      }
    },
  )

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

describe('asking about a script by its code', () => {
  test('answers what the row says', () => {
    expect(drawsScript('Latn')).toBe(true)
    expect(drawsScript('Cyrl')).toBe(true)
    expect(drawsScript('Jpan')).toBe(true)
    expect(drawsScript('Deva')).toBe(false)
    expect(drawsScript('Arab')).toBe(false)
    expect(drawsScript('Ethi')).toBe(false)
  })

  test('and answers yes for a script nobody has listed', () => {
    expect(drawsScript(undefined)).toBe(true)
    expect(drawsScript('')).toBe(true)
    expect(drawsScript('Runr')).toBe(true)
  })
})
