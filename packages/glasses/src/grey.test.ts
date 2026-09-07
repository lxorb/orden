import { describe, expect, test } from 'vitest'
import { CODE_PALETTES } from '@nib/editor'
import { codeGreys, type CodeRole, colourLuminance, greyOf, luminance, ROLE_LOOKS } from './grey'
import { WHITE } from './panel'

const ROLES = Object.keys(ROLE_LOOKS) as CodeRole[]

describe('the code theme in greys', () => {
  test.each(CODE_PALETTES.map((one) => [one.name, one] as const))(
    'gives %s a level inside every role band',
    (_name, palette) => {
      const greys = codeGreys(palette)
      for (const role of ROLES) {
        const [low, high] = ROLE_LOOKS[role].band
        expect(greys[role].level, role).toBeGreaterThanOrEqual(low)
        expect(greys[role].level, role).toBeLessThanOrEqual(high)
      }
    },
  )

  test.each(CODE_PALETTES.map((one) => [one.name, one] as const))(
    'tells every role of %s apart',
    (_name, palette) => {
      const greys = codeGreys(palette)
      const seen = ROLES.map((role) => {
        const one = greys[role]
        return `${one.level}/${one.weight}/${one.slant}`
      })

      expect(new Set(seen).size).toBe(ROLES.length)
    },
  )

  test('keeps a comment behind a keyword in every theme', () => {
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.comment.level, palette.name).toBeLessThan(greys.keyword.level)
      expect(greys.comment.level, palette.name).toBeLessThan(greys.text.level)
    }
  })

  test('reads a colour it can and falls back where it cannot', () => {
    // The palette that follows the app theme is made of `var()`, which only a
    // browser resolves; those land in the middle of their band.
    const follow = CODE_PALETTES.find((one) => one.id === 'follow')!
    const [low, high] = ROLE_LOOKS.string.band
    expect(codeGreys(follow).string.level).toBe(Math.round((low + high) / 2))

    // Three strings, three luminances: Dracula's is pale yellow, Solarized's a
    // teal, GitHub's a navy. So the theme still reaches the panel.
    const level = (id: string) =>
      codeGreys(CODE_PALETTES.find((one) => one.id === id)!).string.level
    expect(level('dracula')).toBeGreaterThan(level('solarized'))
    expect(level('solarized')).toBeGreaterThan(level('github'))
  })

  test('reads the two colour spellings, and nothing else', () => {
    expect(colourLuminance('#fff')).toBeCloseTo(1)
    expect(colourLuminance('#000000')).toBe(0)
    expect(colourLuminance('rgb(255, 255, 255)')).toBeCloseTo(1)
    expect(colourLuminance('var(--accent)')).toBeNull()
    expect(colourLuminance('rebeccapurple')).toBeNull()
  })

  test('puts a luminance on the sixteen levels', () => {
    expect(greyOf(0)).toBe(0)
    expect(greyOf(1)).toBe(WHITE)
    expect(greyOf(0.5)).toBe(8)
    // Out of range rather than throwing: a dither can push a pixel past both
    // ends and the panel has no level beyond them.
    expect(greyOf(-1)).toBe(0)
    expect(greyOf(2)).toBe(WHITE)
  })

  test('weighs green the most, as the eye does', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0))
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })

  test('gives a keyword the brightest band and the bold face', () => {
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.keyword.weight, palette.name).toBe('bold')
      for (const role of ROLES) {
        if (role === 'keyword' || role === 'inserted' || role === 'invalid') continue
        expect(greys.keyword.level, `${palette.name}: ${role}`).toBeGreaterThanOrEqual(
          greys[role].level,
        )
      }
    }
  })

  test('says what a diff means whatever the theme says', () => {
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.inserted.level, palette.name).toBe(WHITE)
      expect(greys.deleted.level, palette.name).toBeLessThan(greys.text.level)
    }
  })

  test('leaves the two dimmest levels alone, which nobody can read', () => {
    for (const palette of CODE_PALETTES) {
      for (const role of ROLES) {
        expect(codeGreys(palette)[role].level, `${palette.name}: ${role}`).toBeGreaterThan(2)
      }
    }
  })
})
