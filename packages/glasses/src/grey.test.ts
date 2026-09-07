import { describe, expect, test } from 'vitest'
import { CODE_PALETTES } from '@nib/editor'
import {
  codeGreys,
  type CodeRole,
  colourLuminance,
  FLOOR,
  greyOf,
  luminance,
  ROLE_LOOKS,
} from './grey'
import { WHITE } from './panel'

const ROLES = Object.keys(ROLE_LOOKS) as CodeRole[]

describe('the code theme in greys', () => {
  /** Read off a real G2 rather than off a screenshot. A page of code that grades
   *  beautifully on a black monitor is a page whose bottom third has gone on the
   *  glass: the panel lights pixels rather than inking them, it is looked
   *  through, and whatever is behind it competes. Comments used to sit at three
   *  of fifteen and were the first thing anybody complained about. */
  test.each(CODE_PALETTES.map((one) => [one.name, one] as const))(
    'never draws a token of %s below the floor',
    (_name, palette) => {
      const greys = codeGreys(palette)
      for (const role of ROLES) {
        expect(greys[role].level, role).toBeGreaterThanOrEqual(FLOOR)
      }
    },
  )

  test('cannot be pushed under the floor by a palette, whatever it says', () => {
    // The bands are what stop a theme made for paper, where a keyword may be the
    // darkest thing on the line, from putting a role out of sight.
    for (const [role, look] of Object.entries(ROLE_LOOKS)) {
      expect(look.band[0], role).toBeGreaterThanOrEqual(FLOOR)
      expect(look.band[1], role).toBeLessThanOrEqual(WHITE)
      expect(look.band[0], role).toBeLessThanOrEqual(look.band[1])
    }
  })

  test('a comment is told apart by its slant, not by being dim', () => {
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.comment.slant).toBe('italic')
      // As bright as plain code, which is how a comment reads on paper and in
      // every editor anybody has used.
      expect(greys.comment.level).toBeGreaterThanOrEqual(greys.text.level)
    }
  })

  test('uses few enough levels that a reader can tell them apart', () => {
    // Sixteen levels graded into six bands put most pairs one step apart, which
    // on glass is no difference at all. Four levels are four somebody can see.
    const levels = new Set(
      CODE_PALETTES.flatMap((palette) => ROLES.map((role) => codeGreys(palette)[role].level)),
    )

    // Thirteen of the sixteen levels were reachable before; six now.
    expect(levels.size).toBeLessThanOrEqual(6)
  })

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

  test('keeps a comment behind a keyword without hiding it', () => {
    // Behind, not below the floor. A comment used to be dimmer than the code it
    // explains, which on a real panel meant it was not there; it is the same ink
    // as plain code now and recedes by its slant instead.
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.comment.level, palette.name).toBeLessThan(greys.keyword.level)
      expect(greys.comment.level, palette.name).toBeGreaterThanOrEqual(greys.text.level)
      expect(greys.comment.slant, palette.name).toBe('italic')
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
    // The bands are narrow now, so a theme moves a role by a step rather than
    // across the panel. It still moves it, which is the point.
    expect(level('dracula')).toBeGreaterThanOrEqual(level('solarized'))
    expect(level('solarized')).toBeGreaterThanOrEqual(level('github'))
    expect(level('dracula')).toBeGreaterThan(level('github'))
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
    // Added and removed mean the same in every theme, so neither is left to a
    // palette. Removed recedes by being the dimmest and the slanted, not by
    // being invisible.
    for (const palette of CODE_PALETTES) {
      const greys = codeGreys(palette)
      expect(greys.inserted.weight, palette.name).toBe('bold')
      expect(greys.deleted.level, palette.name).toBeLessThan(greys.inserted.level)
      expect(greys.deleted.slant, palette.name).toBe('italic')
      expect(greys.deleted.level, palette.name).toBeGreaterThanOrEqual(FLOOR)
    }
  })
})
