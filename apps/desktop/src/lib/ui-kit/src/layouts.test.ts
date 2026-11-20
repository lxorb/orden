import { afterEach, describe, expect, test, vi } from 'vitest'
import { keyOf, matchesCombination, readCombination, type Platform } from './keys'
import { LAYOUTS, LETTER_CODES, LETTERS, letterUnder, pressOn, readsLayout, writtenUnder } from '../test/layouts'

const PLATFORMS: Platform[] = ['win', 'linux', 'mac']
const laidOut = (layout: Record<string, string> | null) => readsLayout(layout, vi.stubGlobal)
afterEach(async () => {
  await laidOut(null)
  vi.unstubAllGlobals()
})
describe.each(Object.keys(LAYOUTS))('the %s layout', (name) => {
  const layout = LAYOUTS[name] ?? {}
  const codes = Object.keys(layout).filter((code) => !code.startsWith('Digit'))
  const lettered = codes.filter((code) => letterUnder(layout, code) !== undefined)
  test.each(PLATFORMS)(
    'runs each letter chord on the one key that writes it, or under it with no Latin (%s)',
    (platform) => {
      const mod = platform === 'mac' ? { meta: true } : { ctrl: true }
      for (const code of codes) {
        const answers = LETTERS.filter((one) => matchesCombination(`Mod-${one}`, pressOn(layout, code, mod), platform))
        const under = letterUnder(layout, code)
        expect(answers, `${name} ${code}`).toEqual(under === undefined ? [] : [under])
      }
      for (const letter of LETTERS) {
        const keys = codes.filter((code) => matchesCombination(`Mod-${letter}`, pressOn(layout, code, mod), platform))
        expect(keys.length, `${name} Mod-${letter}`).toBe(1)
      }
    },
  )
  test('keeps Shift on the key that writes the letter', () => {
    for (const code of lettered) {
      const event = pressOn(layout, code, { ctrl: true, shift: true })
      const answers = LETTERS.filter((one) => matchesCombination(`Mod-Shift-${one}`, event, 'win'))
      expect(answers, `${name} ${code}`).toEqual([letterUnder(layout, code)])
    }
  })
  test('reads back each press as the chord it runs', () => {
    for (const code of lettered) {
      const event = pressOn(layout, code, { ctrl: true })
      const written = readCombination(event, 'win')
      expect(written, `${name} ${code}`).toBe(`Mod-${letterUnder(layout, code) ?? ''}`)
      expect(matchesCombination(written ?? '', event, 'win')).toBe(true)
    }
  })
  test('takes the key under an Option key from the layout, not from the key position', async () => {
    await laidOut(layout)
    for (const code of LETTER_CODES) {
      expect(keyOf({ key: 'ƒ', code, altKey: true }, 'mac'), `${name} ${code}`).toBe(writtenUnder(layout, code))
    }
  })
  test('runs the tab digits from the digit row whatever it writes', () => {
    for (let digit = 0; digit <= 9; digit++) {
      const event = pressOn(layout, `Digit${digit}`, { ctrl: true })
      expect(matchesCombination(`Mod-${digit}`, event, 'win'), `${name} ${digit}`).toBe(true)
    }
  })
})
describe('a punctuation chord', () => {
  test('runs on the key that writes it, never on the key that sits where it does on QWERTY too', async () => {
    const qwertz = LAYOUTS.qwertz ?? {}
    await laidOut(qwertz)
    expect(matchesCombination('Mod--', pressOn(qwertz, 'Slash', { ctrl: true }), 'win')).toBe(true)
    expect(matchesCombination('Mod--', pressOn(qwertz, 'Minus', { ctrl: true }), 'win')).toBe(false)
  })
  test('with Shift held is named by the key under it', async () => {
    const shifted = { ...pressOn(LAYOUTS.qwerty ?? {}, 'Slash', { ctrl: true, shift: true }), key: '?' }
    expect(matchesCombination('Mod-Shift-/', shifted, 'win')).toBe(true)
    await laidOut(LAYOUTS.qwerty ?? null)
    expect(matchesCombination('Mod-Shift-/', shifted, 'win')).toBe(true)
  })
})
describe('a layout read before the switch to a Cyrillic one', () => {
  test('never turns the Cyrillic letter into the old Latin one', async () => {
    await laidOut(LAYOUTS.colemak ?? null)
    expect(matchesCombination('Mod-t', pressOn(LAYOUTS.russian ?? {}, 'KeyF', { ctrl: true }), 'win')).toBe(false)
  })
})
