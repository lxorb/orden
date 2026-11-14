import { describe, expect, test } from 'vitest'
import { AltHold, numerals, type Stroke } from './numbers'

const SHIPPED: Record<string, string> = {
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, at) => [`app.note-${at + 1}.alt`, `Alt-${at + 1}`]),
  ),
  'app.note-ninth': 'Alt-9',
  'app.note-9.alt': 'Alt-0',
}

const shipped = (id: string) => SHIPPED[id] ?? null

describe('the numbers on the tabs', () => {
  test('are the places, and the last tab wears 0', () => {
    expect(numerals(4, shipped, 'win')).toEqual(['1', '2', '3', '0'])
  })

  test('a lone tab is the last one', () => {
    expect(numerals(1, shipped, 'win')).toEqual(['0'])
  })

  test('past nine, the ninth wears 9 and the ones after it nothing but the last', () => {
    expect(numerals(12, shipped, 'win')).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      null,
      null,
      '0',
    ])
  })

  test('with exactly nine, the ninth is the last and wears 0', () => {
    expect(numerals(9, shipped, 'win').at(-1)).toBe('0')
  })

  test('follow the keys as they are bound now', () => {
    const rebound = (id: string) =>
      id === 'app.note-2.alt' ? 'Alt-x' : id === 'app.note-3.alt' ? 'Mod-Alt-3' : shipped(id)
    expect(numerals(4, rebound, 'win')).toEqual(['1', 'X', null, '0'])
  })

  test('and say nothing where no key is held under Alt, as on a Mac', () => {
    expect(numerals(3, () => null, 'mac')).toEqual([null, null, null])
  })
})

const stroke = (key: string, more: Partial<Stroke> = {}): Stroke => ({
  key,
  code: /^\d$/.test(key) ? `Digit${key}` : key,
  altKey: true,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  altGraph: false,
  ...more,
})

describe('Alt held', () => {
  test('shows the numbers the moment it goes down, and carries on through its repeats', () => {
    const hold = new AltHold()
    expect(hold.down(stroke('Alt'))).toBe(true)
    expect(hold.down(stroke('Alt', { repeat: true }))).toBe(false)
    expect(hold.holding).toBe(true)
  })

  test('a tap of Alt right after a tap shows nothing, and one long after shows them again', () => {
    const hold = new AltHold()
    expect(hold.down(stroke('Alt'), 1000)).toBe(true)
    hold.released(1080)
    expect(hold.down(stroke('Alt'), 1200)).toBe(false)
    expect(hold.holding).toBe(false)
    hold.released(1260)
    expect(hold.down(stroke('Alt'), 1380)).toBe(false)
    hold.released(1440)
    expect(hold.down(stroke('Alt'), 3000)).toBe(true)
    hold.released(4000)
    expect(hold.down(stroke('Alt'), 4100)).toBe(true)
  })

  test('a repeat not flagged as one is the same hold, not a new one', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    expect(hold.down(stroke('Alt'))).toBe(false)
    expect(hold.holding).toBe(true)
  })

  test('keeps them through Alt and a digit, and puts them where the new tab is', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    for (const digit of ['3', '1', '0']) {
      expect(hold.down(stroke(digit)), digit).toBe(true)
      expect(hold.holding, digit).toBe(true)
    }
    expect(hold.down(stroke('2', { repeat: true }))).toBe(true)
    expect(hold.holding).toBe(true)
  })

  test('a digit with Alt shows them even where the Alt itself was not heard', () => {
    const hold = new AltHold()
    expect(hold.down(stroke('4'))).toBe(true)
    expect(hold.holding).toBe(true)
  })

  test('a digit is known by its place on a keyboard whose top row types something else', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    expect(hold.down(stroke('&', { code: 'Digit1' }))).toBe(true)
    expect(hold.holding).toBe(true)
    const unheard = new AltHold()
    expect(unheard.down(stroke('1', { code: 'Numpad1' }))).toBe(false)
    expect(unheard.holding).toBe(false)
  })

  test('stay through any other key held with Alt, and go only as Alt is let go of', () => {
    for (const key of ['F4', 'ArrowLeft', 'd', 'Unidentified']) {
      const hold = new AltHold()
      hold.down(stroke('Alt'))
      hold.down(stroke('2'))
      expect(hold.down(stroke(key)), key).toBe(true)
      expect(hold.holding, key).toBe(true)
      expect(hold.down(stroke('Alt', { repeat: true })), key).toBe(false)
      expect(hold.holding, key).toBe(true)

      hold.released()
      expect(hold.holding, key).toBe(false)
    }
  })

  test('a key without Alt ends a hold whose release was not heard', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    expect(hold.down(stroke('a', { altKey: false }))).toBe(false)
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('Alt'))).toBe(true)
  })

  test('AltGr never shows them, however a keyboard names it, nor with a digit', () => {
    const hold = new AltHold()
    hold.down(stroke('Control', { ctrlKey: true, altKey: false }))
    expect(hold.down(stroke('Alt', { ctrlKey: true }))).toBe(false)
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('@', { code: 'Digit2', ctrlKey: true }))).toBe(false)
    expect(hold.holding).toBe(false)
    hold.released()

    expect(hold.down(stroke('AltGraph', { ctrlKey: true, altGraph: true }))).toBe(false)
    expect(hold.down(stroke('Alt', { altGraph: true }))).toBe(false)
    expect(hold.down(stroke('7', { altGraph: true }))).toBe(false)
    expect(hold.holding).toBe(false)
  })

  test('nor is Alt with Shift, the switch between keyboards, either way round', () => {
    const hold = new AltHold()
    hold.down(stroke('Shift', { shiftKey: true, altKey: false }))
    hold.down(stroke('Alt', { shiftKey: true }))
    expect(hold.holding).toBe(false)
    hold.released()

    hold.down(stroke('Alt'))
    hold.down(stroke('Shift', { shiftKey: true }))
    expect(hold.holding).toBe(true)
  })

  test('a press or move of the pointer keeps them, and corrects what was not heard', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    expect(hold.sense(true)).toBe(false)
    expect(hold.holding).toBe(true)
    expect(hold.sense(false)).toBe(false)
    expect(hold.holding).toBe(false)
    expect(hold.sense(true)).toBe(true)
    expect(hold.holding).toBe(true)
    hold.released()
    expect(hold.sense(true, true)).toBe(false)
    expect(hold.holding).toBe(false)
  })

  test('the pointer brings back nothing during Alt Alt, the overview key (#331)', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'), 1000)
    hold.released(1080)
    hold.down(stroke('Alt'), 1200)
    expect(hold.sense(true)).toBe(false)
    expect(hold.holding).toBe(false)
  })

  test('keys typed without Alt never begin one', () => {
    const hold = new AltHold()
    for (const key of ['a', '3', 'Enter']) hold.down(stroke(key, { altKey: false }))
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('Alt'))).toBe(true)
  })

  test("an Essential's letter begins a hold where Alt was not heard, another letter not", () => {
    const hold = new AltHold()
    expect(hold.down(stroke('f', { code: 'KeyF' }))).toBe(false)
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('n', { code: 'KeyN' }), Number.NaN, true)).toBe(true)
    expect(hold.holding).toBe(true)
  })
})
