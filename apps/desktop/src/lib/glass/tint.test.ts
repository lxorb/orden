import { glassCss } from '@nib/themes/glass'
import { describe, expect, test } from 'vitest'
import { linkOf, type PaperInks } from '../content-ground'
import { AA, hexOf, luminance, type Rgb, over, ratio, rgbOf, SHARP } from '../legibility'
import { paletteOf } from '../wallpaper/floors'
import { along, DAWN, PAIRS, type Stops, stopsOf } from './pairs'
import {
  barFor,
  DIALS,
  frameFor,
  GRAIN,
  type Material,
  MARK_TONE,
  PAGE_WASH,
  pairFor,
  type Scheme,
  type Sides,
  spanUnder,
} from './tint'

const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
const dark = paletteOf(glassCss, 'dark', names)
const light = paletteOf(glassCss, 'light', names)
if (!dark || !light) throw new Error('glass.css no longer states both sides')
const sides: Sides = { dark, light }

const PAPER: Record<Scheme, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
const SCHEMES: Scheme[] = ['dark', 'light']
const MATERIALS: Material[] = ['mica', 'acrylic', 'clear', null]

function rgb(hex: string): Rgb {
  const found = rgbOf(hex)
  if (!found) throw new Error(`not a colour: ${hex}`)
  return found
}

/** The four sites Emil's brief names, and a few more of the shapes the web comes in. */
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

/** Whether one side's quietest word reads on a ground, alone and under a row's lift. */
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
    // Still red: the colour moved toward one side's chrome, not to it.
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
  test('is the page over the material, and mostly the page on paper', () => {
    const frame = frameFor(
      { colour: SITES['white Google']!, page: true },
      'dark',
      'mica',
      sides,
      PAPER.dark,
    )
    expect(frame.tint).toBe('#ffffff')
    expect(frame.scheme).toBe('light')
    expect(frame.wash).toBeGreaterThanOrEqual(frame.floor)

    const paper = frameFor({ colour: SITES.red!, page: true }, 'dark', null, sides, PAPER.dark)
    expect(paper.wash).toBeGreaterThanOrEqual(PAGE_WASH)
  })

  test('keeps every word at AA over every colour the material can be, for every site', () => {
    for (const [name, page] of Object.entries(SITES)) {
      for (const app of SCHEMES) {
        for (const material of MATERIALS) {
          const frame = frameFor({ colour: page, page: true }, app, material, sides, PAPER[app])
          const span = spanUnder(material, app, PAPER[app])
          for (const under of [span.least, span.most]) {
            const ground = over(rgb(frame.tint), frame.wash, under)
            expect(reads(frame.scheme, ground), `${name}, ${app}, ${String(material)}`).toBe(true)
          }
        }
      }
    }
  })

  test("is a tone of a note's mark, always in the reader's own scheme", () => {
    const green: Rgb = [0, 160, 90]
    const frame = frameFor({ colour: green, page: false }, 'dark', 'mica', sides, PAPER.dark)
    // A tone of it: greener than the chrome, and no more of it than MARK_TONE.
    const [r, g] = rgb(frame.tint)
    expect(g).toBeGreaterThan(sides.dark.scrim[1] + 8)
    expect(g).toBeGreaterThan(r + 8)
    expect(g).toBeLessThanOrEqual(Math.round(over(green, MARK_TONE, sides.dark.scrim)[1]))

    for (const mark of [
      [124, 107, 245],
      [255, 255, 0],
      [0, 0, 0],
    ] as Rgb[]) {
      for (const app of SCHEMES) {
        expect(frameFor({ colour: mark, page: false }, app, 'mica', sides, PAPER[app]).scheme).toBe(
          app,
        )
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
        for (const material of MATERIALS) {
          const frame = frameFor({ colour: mark, page: false }, app, material, sides, PAPER[app])
          const span = spanUnder(material, app, PAPER[app])
          for (const under of [span.least, span.most]) {
            const ground = over(rgb(frame.tint), frame.wash, under)
            expect(
              reads(frame.scheme, ground),
              `${mark.join(',')}, ${app}, ${String(material)}`,
            ).toBe(true)
          }
        }
      }
    }
  })
})

/** The paper's inks in each scheme, as follow.svelte.ts reads them. */
const INKS: Record<Scheme, PaperInks> = {
  dark: {
    bg: PAPER.dark,
    text: dark.text,
    muted: dark.ink,
    link: linkOf([124, 107, 245], [255, 255, 255]),
  },
  light: {
    bg: PAPER.light,
    text: light.text,
    muted: light.ink,
    link: linkOf([91, 75, 224], [5, 7, 10]),
  },
}

describe("glass's own dials", () => {
  const sources = [
    ...Object.values(SITES).map((colour) => ({ colour, page: true })),
    { colour: [124, 107, 245] as Rgb, page: false },
    { colour: [255, 255, 0] as Rgb, page: false },
  ]

  test('hold every word at its aim at every end of Opacity and Tint, over every material', () => {
    for (const source of sources) {
      for (const app of SCHEMES) {
        for (const material of MATERIALS) {
          for (const opacity of [0, 0.5, 1]) {
            for (const strength of [0, 1]) {
              const frame = frameFor(
                source,
                app,
                material,
                sides,
                PAPER[app],
                { opacity, strength },
                INKS[app],
              )
              const what = `${source.colour.join(',')}, ${app}, ${String(material)}, ${opacity}, ${strength}`
              expect(frame.wash, what).toBeGreaterThanOrEqual(frame.floor)
              if (material) expect(frame.wash, what).toBeGreaterThanOrEqual(opacity)
              const span = spanUnder(material, app, PAPER[app])
              const aim = material === 'clear' ? SHARP : AA
              for (const under of [span.least, span.most]) {
                const ground = over(rgb(frame.tint), frame.wash, under)
                expect(ratio(sides[frame.scheme].ink, ground), what).toBeGreaterThanOrEqual(aim)
                expect(reads(frame.scheme, ground), what).toBe(true)

                // And the note, on the least paper the Content row may lay over that.
                const paper = over(INKS[app].bg, frame.paper, ground)
                expect(ratio(INKS[app].text, paper), what).toBeGreaterThanOrEqual(7)
                expect(ratio(INKS[app].muted, paper), what).toBeGreaterThanOrEqual(AA)
              }
            }
          }
        }
      }
    }
  })

  test('at full Opacity are the frame’s colour alone, and with no Tint the chrome’s', () => {
    const page = { colour: SITES['Twitter blue']!, page: true }
    expect(
      frameFor(page, 'dark', 'mica', sides, PAPER.dark, { opacity: 1, strength: 1 }).wash,
    ).toBe(1)
    const plain = frameFor(page, 'dark', 'mica', sides, PAPER.dark, { opacity: 0.5, strength: 0 })
    const scheme = barFor(SITES['Twitter blue']!, 'dark', sides).scheme
    expect(rgb(plain.tint)).toEqual(sides[scheme].scrim.map(Math.round))
  })

  test('start where glass always started: half the colour, all of what is open', () => {
    expect(DIALS).toEqual({ opacity: 0.5, strength: 1 })
  })

  test('over the desk with no blur ask more than over Mica, which keeps its brightness', () => {
    const mark = { colour: [124, 107, 245] as Rgb, page: false }
    const mica = frameFor(mark, 'dark', 'mica', sides, PAPER.dark, { opacity: 0, strength: 1 })
    const clear = frameFor(mark, 'dark', 'clear', sides, PAPER.dark, { opacity: 0, strength: 1 })
    expect(clear.floor).toBeGreaterThan(mica.floor)
  })
})

describe("glass's own pair", () => {
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]

  /** Whether one side's quietest word reads on a ground with the grain's lightest and
   *  darkest speck on it: at `aim` on the ground itself, and at AA on the list's layer,
   *  under a row's lift and both - what the frame's own tests above ask of a colour. */
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
    // Blue first: more blue than red; pink-purple second: more red than green.
    expect(blue![2]).toBeGreaterThan(blue![0])
    expect(pink![0]).toBeGreaterThan(pink![1])
  })

  test('wears each pair it offers as it is, and over Mica lets the material show', () => {
    for (const pair of PAIRS) {
      for (const app of SCHEMES) {
        const stops = stopsOf(pair.id, app, 'violet', dark.scrim)
        const solid = pairFor(stops, app, null, sides, PAPER[app])
        expect([solid.tint, solid.second], `${pair.id}, ${app}`).toEqual(pair[app])
        expect(solid.scheme).toBe(app)
        const mica = pairFor(stops, app, 'mica', sides, PAPER[app])
        expect(mica.floor, `${pair.id}, ${app} over Mica`).toBeLessThanOrEqual(0.8)
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

  test('keeps every word at its aim over every colour of the blend, the grain and the material', () => {
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
        for (const material of MATERIALS) {
          for (const opacity of [0, 0.5, 1]) {
            for (const strength of [0, 0.5, 1]) {
              const frame = pairFor(
                stopsFor(app),
                app,
                material,
                sides,
                PAPER[app],
                { opacity, strength },
                INKS[app],
              )
              const what = `${name}, ${app}, ${String(material)}, ${opacity}, ${strength}`
              expect(frame.wash, what).toBeGreaterThanOrEqual(frame.floor)
              if (material) expect(frame.wash, what).toBeGreaterThanOrEqual(opacity)
              const span = spanUnder(material, app, PAPER[app])
              const aim = material === 'clear' ? SHARP : AA
              for (const colour of along([rgb(frame.tint), rgb(frame.second)])) {
                for (const under of [span.least, span.most]) {
                  const ground = over(colour, frame.wash, under)
                  expect(readsGrained(app, ground, aim), what).toBe(true)

                  // And the note, on the least paper the Content row may lay over that.
                  for (const speck of [white, black]) {
                    const paper = over(INKS[app].bg, frame.paper, over(speck, GRAIN, ground))
                    expect(ratio(INKS[app].text, paper), what).toBeGreaterThanOrEqual(7)
                    expect(ratio(INKS[app].muted, paper), what).toBeGreaterThanOrEqual(AA)
                  }
                }
              }
            }
          }
        }
      }
    }
  })

  test('with no Tint is the chrome alone, and in the reader’s own scheme whatever its colours', () => {
    const plain = pairFor(own['white to black']!, 'light', 'mica', sides, PAPER.light, {
      opacity: 0.5,
      strength: 0,
    })
    expect(plain.tint).toBe(plain.second)
    expect(rgb(plain.tint)).toEqual(sides.light.scrim.map(Math.round))
    for (const app of SCHEMES) {
      expect(pairFor(own['red to green']!, app, null, sides, PAPER[app]).scheme).toBe(app)
    }
  })

  test('paints exactly the grain the sums count', () => {
    expect(glassCss).toContain(`intercept='${GRAIN}'`)
  })
})
