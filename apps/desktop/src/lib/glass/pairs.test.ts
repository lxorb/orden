import { describe, expect, test } from 'vitest'
import { de } from '../../locales/de'
import { accentColour } from '../accents'
import { hexOf, luminance, type Rgb } from '../legibility'
import { ACCENT_PAIR, along, DAWN, isOwn, ownOf, PAIRS, shownOf, stopsOf, swatchOf } from './pairs'

const SCRIM: Rgb = [25, 30, 38]

describe("glass's pairs", () => {
  test('start on Dawn, and fall back to it for anything they cannot mean', () => {
    for (const held of [undefined, 'dawn', 'gone', 42, '#12345 #abcdef']) {
      expect(stopsOf(held, 'light', 'violet', SCRIM).map(hexOf)).toEqual(DAWN.light)
      expect(stopsOf(held, 'dark', 'violet', SCRIM).map(hexOf)).toEqual(DAWN.dark)
    }
  })

  test('each have a shade per scheme, two colours, and a name the catalogues carry', () => {
    const ids = new Set(PAIRS.map((one) => one.id))
    expect(ids.size).toBe(PAIRS.length)
    expect(ids.has(ACCENT_PAIR)).toBe(false)
    for (const pair of PAIRS) {
      for (const shade of [...pair.light, ...pair.dark]) expect(shade).toMatch(/^#[0-9a-f]{6}$/)
      expect(Object.keys(de), pair.name).toContain(pair.name)
      expect(swatchOf(pair, 'dark')).toBe(
        `linear-gradient(135deg, ${pair.dark[0]}, ${pair.dark[1]})`,
      )
    }
  })

  test('the accent is one colour in both corners, its shade for the scheme', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const shade = accentColour('teal', scheme)
      expect(stopsOf(ACCENT_PAIR, scheme, 'teal', SCRIM).map(hexOf)).toEqual([shade, shade])
      expect(shownOf(ACCENT_PAIR, scheme, 'teal')).toEqual([shade, shade])
    }
  })

  test('two of the reader’s own are kept as one value, and worn as picked by day', () => {
    const held = ownOf('#AABBCC', '#112233')
    expect(held).toBe('#aabbcc #112233')
    expect(isOwn(held)).toBe(true)
    for (const not of ['dawn', '#aabbcc', '#aabbcc,#112233', 7]) expect(isOwn(not)).toBe(false)
    expect(stopsOf(held, 'light', 'violet', SCRIM).map(hexOf)).toEqual(['#aabbcc', '#112233'])
    expect(shownOf(held, 'dark', 'violet')).toEqual(['#aabbcc', '#112233'])
  })

  test('at night a light colour of one’s own is a deep version of itself, a dark one as picked', () => {
    const [deep, kept] = stopsOf(ownOf('#bfddfb', '#1d2a3d'), 'dark', 'violet', SCRIM)
    expect(luminance(deep)).toBeLessThan(0.05)
    // Still blue: more blue than red.
    expect(deep[2]).toBeGreaterThan(deep[0] + 8)
    expect(hexOf(kept)).toBe('#1d2a3d')
  })

  test('the blend is checked from one corner to the other', () => {
    const blend = along([
      [0, 0, 0],
      [200, 100, 0],
    ])
    expect(blend[0]).toEqual([0, 0, 0])
    expect(blend.at(-1)).toEqual([200, 100, 0])
    expect(blend.length).toBeGreaterThan(4)
  })

  test('show as the two shades of the scheme they are picked in', () => {
    expect(shownOf('lagoon', 'light', 'violet')).toEqual(PAIRS[1]?.light)
    expect(shownOf(undefined, 'dark', 'violet')).toEqual(DAWN.dark)
  })
})
