import { describe, expect, test } from 'vitest'
import { pageSheet } from '../src/gallery/page-sheet'
import { isNewer, readIndex } from '../src/gallery/registry'
import { review } from '../src/gallery/validate'
import { lookOf } from '../src/picker/looks'
import { SCHEME_CHOICES, SCHEME_NAMES } from '../src/picker/schemes'
import { floorFor, paletteOf } from '../src/wallpaper/floors'

const PAIR = `[data-theme=light] { --bg: #fff; --text: #111 }\n[data-theme=dark] { --bg: #000; --text: #eee }\n#write p { margin: 0 }`

describe('a published page sheet', () => {
  test('keeps shared rules, prefers light, and follows the system and the explicit scheme', () => {
    const sheet = pageSheet(PAIR)
    expect(sheet).toContain('#write p { margin: 0 }')
    expect(sheet).toContain(':root { --bg: #fff; --text: #111 }')
    expect(sheet).toContain(
      "@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --bg: #000; --text: #eee } }",
    )
    expect(sheet).toContain(":root[data-theme='dark'] { --bg: #000; --text: #eee }")
    expect(sheet).toContain(
      "@media print { :root, :root[data-theme='dark'] { --bg: #fff; --text: #111 } }",
    )
  })
})

describe('the theme catalogue', () => {
  test('reads an index, keeps each id once and drops what is not a theme', () => {
    const rose = {
      id: 'rose',
      name: 'Rose',
      author: 'Orden',
      version: '1.0.0',
      description: 'A warm one',
      tags: ['warm'],
      licence: 'MIT',
      variants: ['light', 'dark'],
      updated: '2026-01-01',
      palettes: { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } },
    }
    const themes = readIndex({ themes: [rose, rose, { id: 'broken' }, 'nothing'] })
    expect(themes.map((one) => one.id)).toEqual(['rose'])
    expect(themes[0]?.palettes.dark).toEqual({ '--bg': '#000' })
    expect(readIndex(null)).toEqual([])
  })

  test('compares versions number by number', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.9', '1.0.0')).toBe(false)
  })
})

describe('the theme reviewer', () => {
  test('keeps token blocks and prose rules, refuses what reaches past them', () => {
    const reviewed = review(`${PAIR}\nbody { background: url(x) }`)
    expect(reviewed.variants).toEqual(['light', 'dark'])
    expect(reviewed.css).toContain('--bg: #fff')
    expect(reviewed.css).not.toContain('url(x)')
    expect(reviewed.refused.length).toBeGreaterThan(0)
  })

  test('refuses a sheet that is too large to be a theme', () => {
    const big = review(`:root { --x: ${'a'.repeat(49 * 1024)} }`)
    expect(big.css).toBe('')
    expect(big.refused).toEqual(['the file is larger than 48 kB'])
  })
})

describe("a picker card's look", () => {
  test('is read from the sheets for the scheme asked, inline values winning', () => {
    const look = lookOf([PAIR, ':root { --accent: #abc }'], 'dark', { '--muted': '#888' })
    expect(look.ground).toBe('#000')
    expect(look.text).toBe('#eee')
    expect(look.accent).toBe('#abc')
    expect(look.muted).toBe('#888')
    expect(lookOf([PAIR], 'light').ground).toBe('#fff')
  })

  test('the three schemes are named for the picker', () => {
    expect(SCHEME_CHOICES).toEqual(['system', 'dark', 'light'])
    expect(SCHEME_CHOICES.map((one) => SCHEME_NAMES[one])).toEqual(['System', 'Dark', 'Light'])
  })
})

describe("the wallpaper's scrim", () => {
  const SHEET = `[data-theme=dark] { --muted: #9aa; --text: #fff; --wallpaper-scrim: #000; --wallpaper-layer: rgb(255 255 255 / 0.1); }`

  test('reads its palette from the sheet and finds a floor that keeps words legible', () => {
    const palette = paletteOf(SHEET, 'dark')
    expect(palette).not.toBeNull()
    expect(palette?.layer.alpha).toBeCloseTo(0.1)
    expect(paletteOf(SHEET, 'light')).toBeNull()
    if (!palette) return
    const floor = floorFor(palette, { least: [20, 20, 20], most: [230, 230, 230] })
    expect(floor).toBeGreaterThanOrEqual(0)
    expect(floor).toBeLessThanOrEqual(1)
  })
})
