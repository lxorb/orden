import type { Scheme } from '@orden/contracts'
import { glassCss } from '@orden/themes/glass'
import { describe, expect, test } from 'vitest'
import {
  AA,
  hexOf,
  luminance,
  type Rgb,
  over,
  ratio,
  rgbOf,
} from '../../../ui-controls/src/legibility'
import { paletteOf } from '../wallpaper/floors'
import { along, DAWN, PAIRS, type Stops, stopsOf } from './pairs'
import { barFor, DIALS, frameFor, GRAIN, MARK_TONE, PAGE_WASH, pairFor, type Sides } from './tint'

const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
const dark = paletteOf(glassCss, 'dark', names)
const light = paletteOf(glassCss, 'light', names)
if (!dark || !light) throw new Error('glass.css no longer states both sides')
const sides: Sides = { dark, light }

const PAPER: Record<Scheme, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
const SCHEMES: Scheme[] = ['dark', 'light']

function rgb(hex: string): Rgb {
  const found = rgbOf(hex)
  if (!found) throw new Error(`not a colour: ${hex}`)
  return found
}

const SITES: Record<string, Rgb> = {
  'white Google': [255, 255, 255],
  'black YouTube': [15, 15, 15],
  red: [255, 0, 0],
  yellow: [255, 235, 59],
  'Material red': [211, 47, 47],
  'GitHub dark': [13, 17, 23],
  'Twitter blue': [29, 155, 240],
  'mid grey': [128, 128, 128],
  'teal header': [0, 128, 128],
}

function reads(scheme: Scheme, ground: Rgb): boolean {
  const side = sides[scheme]
  const grounds = [
    ground,
    over(side.text, 0.1, ground),
    over(side.layer.colour, side.layer.alpha, ground),
  ]
  return grounds.every((one) => ratio(side.ink, one) >= AA)
}

describe("a page's bar", () => {
  test('is the page itself where its words read on it, which is most pages', () => {
    for (const app of SCHEMES) {
      expect(barFor(SITES['white Google']!, app, sides)).toEqual({
        colour: '#ffffff',
        scheme: 'light',
      })
      expect(barFor(SITES['black YouTube']!, app, sides)).toEqual({
        colour: '#0f0f0f',
        scheme: 'dark',
      })
      expect(barFor(SITES.yellow!, app, sides)).toEqual({
        colour: '#ffeb3b',
        scheme: 'light',
      })
    }
  })

  test('is moved the least way that makes it read where the page is too loud to', () => {
    const bar = barFor(SITES.red!, 'dark', sides)
    expect(bar.colour).not.toBe('#ff0000')
    expect(reads(bar.scheme, rgb(bar.colour))).toBe(true)
    const [r, g, b] = rgb(bar.colour)
    expect(r).toBeGreaterThan(g + 40)
    expect(r).toBeGreaterThan(b + 40)
  })

  test("keeps every word at AA on every site, under either of the reader's schemes", () => {
    for (const [name, page] of Object.entries(SITES)) {
      for (const app of SCHEMES) {
        const bar = barFor(page, app, sides)
        expect(reads(bar.scheme, rgb(bar.colour)), `${name} under ${app}`).toBe(true)
      }
    }
  })
})

describe('the frame', () => {
  test('is mostly the page, and the page alone where it reads as it is', () => {
    const frame = frameFor(
      { colour: SITES['white Google']!, page: true },
      'dark',
      sides,
      PAPER.dark,
    )
    expect(frame.tint).toBe('#ffffff')
    expect(frame.scheme).toBe('light')

    const paper = frameFor({ colour: SITES.red!, page: true }, 'dark', sides, PAPER.dark)
    expect(paper.wash).toBeGreaterThanOrEqual(PAGE_WASH)
  })

  test('keeps every word at AA over the paper beneath it, for every site and every Tint', () => {
    for (const [name, page] of Object.entries(SITES)) {
      for (const app of SCHEMES) {
        for (const strength of [0, 1]) {
          const frame = frameFor({ colour: page, page: true }, app, sides, PAPER[app], { strength })
          const ground = over(rgb(frame.tint), frame.wash, PAPER[app])
          expect(reads(frame.scheme, ground), `${name}, ${app}, ${strength}`).toBe(true)
        }
      }
    }
  })

  test("is a tone of a note's mark, always in the reader's own scheme", () => {
    const green: Rgb = [0, 160, 90]
    const frame = frameFor({ colour: green, page: false }, 'dark', sides, PAPER.dark)
    const [r, g] = rgb(frame.tint)
    expect(g).toBeGreaterThan(sides.dark.scrim[1] + 8)
    expect(g).toBeGreaterThan(r + 8)
    expect(g).toBeLessThanOrEqual(Math.round(over(green, MARK_TONE, sides.dark.scrim)[1]))
    expect(frame.wash).toBe(1)

    for (const mark of [
      [124, 107, 245],
      [255, 255, 0],
      [0, 0, 0],
    ] as Rgb[]) {
      for (const app of SCHEMES) {
        expect(frameFor({ colour: mark, page: false }, app, sides, PAPER[app]).scheme).toBe(app)
      }
    }
  })

  test('keeps every word at AA over a mark of any colour', () => {
    const marks: Rgb[] = [
      [255, 0, 0],
      [255, 255, 0],
      [0, 0, 0],
      [255, 255, 255],
      [0, 200, 120],
      [124, 107, 245],
    ]
    for (const mark of marks) {
      for (const app of SCHEMES) {
        const frame = frameFor({ colour: mark, page: false }, app, sides, PAPER[app])
        const ground = over(rgb(frame.tint), frame.wash, PAPER[app])
        expect(reads(frame.scheme, ground), `${mark.join(',')}, ${app}`).toBe(true)
      }
    }
  })

  test('with no Tint is the chrome’s colour', () => {
    const page = { colour: SITES['Twitter blue']!, page: true }
    const plain = frameFor(page, 'dark', sides, PAPER.dark, { strength: 0 })
    const scheme = barFor(SITES['Twitter blue']!, 'dark', sides).scheme
    expect(rgb(plain.tint)).toEqual(sides[scheme].scrim.map(Math.round))
  })

  test('starts where glass always started: all of what is open', () => {
    expect(DIALS).toEqual({ strength: 1 })
  })
})

describe("glass's own pair", () => {
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]

  function readsGrained(scheme: Scheme, ground: Rgb, aim: number): boolean {
    const side = sides[scheme]
    return [white, black].every((speck) => {
      const grained = over(speck, GRAIN, ground)
      const layered = over(side.layer.colour, side.layer.alpha, grained)
      const stacked = [layered, over(side.text, 0.1, grained), over(side.text, 0.1, layered)]
      return ratio(side.ink, grained) >= aim && stacked.every((one) => ratio(side.ink, one) >= AA)
    })
  }

  const own: Record<string, Stops> = {
    'white to black': [white, black],
    'red to green': [
      [255, 0, 0],
      [0, 200, 0],
    ],
    'yellow to blue': [
      [255, 230, 0],
      [0, 60, 255],
    ],
  }

  test('starts on a light blue in the top left going to a soft pink-purple', () => {
    for (const scheme of SCHEMES) {
      expect(stopsOf(undefined, scheme, 'violet', dark.scrim).map(hexOf)).toEqual(DAWN[scheme])
    }
    const [blue, pink] = DAWN.light.map(rgb)
    expect(blue![2]).toBeGreaterThan(blue![0])
    expect(pink![0]).toBeGreaterThan(pink![1])
  })

  test('wears each pair it offers as it is, whole', () => {
    for (const pair of PAIRS) {
      for (const app of SCHEMES) {
        const solid = pairFor(stopsOf(pair.id, app, 'violet', dark.scrim), app, sides)
        expect([solid.tint, solid.second], `${pair.id}, ${app}`).toEqual(pair[app])
        expect(solid.scheme).toBe(app)
        expect(solid.wash).toBe(1)
      }
    }
  })

  test('is deeper and greyer at night than by day', () => {
    for (const pair of PAIRS) {
      for (const at of [0, 1]) {
        const day = rgb(pair.light[at]!)
        const night = rgb(pair.dark[at]!)
        expect(luminance(night), pair.id).toBeLessThan(0.03)
        expect(luminance(day), pair.id).toBeGreaterThan(0.6)
      }
    }
  })

  test('keeps every word at AA over every colour of the blend and the grain', () => {
    const pairs: Record<string, (app: Scheme) => Stops> = {
      ...Object.fromEntries(
        PAIRS.map((pair) => [
          pair.id,
          (app: Scheme) => stopsOf(pair.id, app, 'violet', dark.scrim),
        ]),
      ),
      accent: (app) => stopsOf('accent', app, 'yellow', dark.scrim),
      ...Object.fromEntries(Object.entries(own).map(([name, stops]) => [name, () => stops])),
    }
    for (const [name, stopsFor] of Object.entries(pairs)) {
      for (const app of SCHEMES) {
        for (const strength of [0, 0.5, 1]) {
          const frame = pairFor(stopsFor(app), app, sides, { strength })
          for (const colour of along([rgb(frame.tint), rgb(frame.second)])) {
            expect(readsGrained(app, colour, AA), `${name}, ${app}, ${strength}`).toBe(true)
          }
        }
      }
    }
  })

  test('with no Tint is the chrome alone, and in the reader’s own scheme whatever its colours', () => {
    const plain = pairFor(own['white to black']!, 'light', sides, { strength: 0 })
    expect(plain.tint).toBe(plain.second)
    expect(rgb(plain.tint)).toEqual(sides.light.scrim.map(Math.round))
    for (const app of SCHEMES) {
      expect(pairFor(own['red to green']!, app, sides).scheme).toBe(app)
    }
  })

  test('paints exactly the grain the sums count', () => {
    expect(glassCss).toContain(`intercept='${GRAIN}'`)
  })
})
