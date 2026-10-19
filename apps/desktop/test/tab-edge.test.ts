import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastCss } from '@nib/themes/contrast'
import { glassCss } from '@nib/themes/glass'
import { wallpaperCss } from '@nib/themes/wallpaper'
import { describe, expect, test } from 'vitest'
import { ACCENTS } from '../src/lib/accents'
import { frameFor, type Material, type Scheme, type Sides, spanUnder } from '../src/lib/glass/tint'
import { over, ratio, type Rgb, rgbOf, type Span } from '../src/lib/legibility'
import { floorFor, paletteOf, sheetColour } from '../src/lib/wallpaper/floors'

/** The open tab, told from the rest at a glance in every theme the app ships.
 *
 *  lxorb, issue #242: *"pretty hard to see which tab is visible for glass theme (color:
 *  gray, but the issue is more general)"*. The open tab was told only by its fill, the
 *  colour of what is under the strip, and under glass and a picture that can be the
 *  frame's own colour. Chrome strokes its open tab where the two are under 1.3 to one
 *  (`TabStrip::ShouldDrawStrokes`); here the stroke is always drawn, as `--tab-edge`, a
 *  lift of the ink, and it is held a step past Chrome's line on every frame a theme can
 *  put behind the tabs: each palette's own, a glass tint over every material and every
 *  accent and page colour, and a picture at its floor. An inactive tab is the frame
 *  itself, so the edge against the frame is the whole of what tells the two apart. */

const FLOOR = 1.5

const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)
const TABS = readFileSync(fileURLToPath(new URL('../src/lib/Tabs.svelte', import.meta.url)), 'utf8')

const SCHEMES: Scheme[] = ['dark', 'light']

function colour(said: string | undefined): Rgb {
  const found = rgbOf(said ?? '')
  if (!found) throw new Error(`not a colour: ${said}`)
  return found
}

/** One side's block of a sheet: the dark one is stated with `:root`. */
function blockOf(css: string, scheme: Scheme): string {
  const head = new RegExp(String.raw`\[data-theme=['"]?${scheme}['"]?\]\s*\{`).exec(css)
  if (!head) return ''
  const from = head.index + head[0].length
  return css.slice(from, css.indexOf('\n}', from))
}

function said(block: string, name: string): string | undefined {
  return new RegExp(String.raw`${name}\s*:\s*([^;]+);`).exec(block)?.[1]?.trim()
}

/** What the edge is over a frame, as a side's sheets state it: the ink at a share,
 *  or a colour of the theme's own. */
type Edge = (frame: Rgb) => Rgb

function edgeOf(text: Rgb, statement: string, own: (name: string) => Rgb): Edge {
  const lift = /^color-mix\(in srgb, var\(--text\) (\d+)%, transparent\)$/.exec(statement)
  if (lift) return (frame) => over(text, Number(lift[1]) / 100, frame)
  const token = /^var\((--[\w-]+)\)$/.exec(statement)
  if (token?.[1]) {
    const solid = own(token[1])
    return () => solid
  }
  throw new Error(`an edge this test cannot read: ${statement}`)
}

/** The edge the built-in states for one side, over that side's ink. */
function builtInEdge(scheme: Scheme, text: Rgb): Edge {
  const statement = said(blockOf(TOKENS, scheme), '--tab-edge')
  if (!statement) throw new Error(`tokens.css states no --tab-edge on the ${scheme} side`)
  return edgeOf(text, statement, (name) => colour(said(blockOf(TOKENS, scheme), name)))
}

/** Colours through a box of them, corners and middles, so a frame laid over anything in
 *  a span is looked at everywhere it can be rather than at its two ends. */
function through(span: Span): Rgb[] {
  const steps = [0, 0.5, 1]
  const out: Rgb[] = []
  for (const r of steps)
    for (const g of steps)
      for (const b of steps) {
        out.push([
          span.least[0] + (span.most[0] - span.least[0]) * r,
          span.least[1] + (span.most[1] - span.least[1]) * g,
          span.least[2] + (span.most[2] - span.least[2]) * b,
        ])
      }
  return out
}

interface Seen {
  where: string
  ratio: number
}

/** The weakest edge over a set of frames. */
function weakest(where: string, frames: Rgb[], edge: Edge): Seen {
  return frames
    .map((frame) => ({ where, ratio: ratio(edge(frame), frame) }))
    .reduce((least, one) => (one.ratio < least.ratio ? one : least))
}

/** The palette a side of a theme writes in: its own block over the built-in's. */
function palette(css: string | null, scheme: Scheme) {
  const own = css ? blockOf(css, scheme) : ''
  const base = blockOf(TOKENS, scheme)
  const token = (name: string) => colour(said(own, name) ?? said(base, name))
  return { token, statement: css ? said(own, '--tab-edge') : undefined }
}

function opaque(name: string, css: string | null): Seen[] {
  return SCHEMES.map((scheme) => {
    const { token, statement } = palette(css, scheme)
    const text = token('--text')
    const edge = statement ? edgeOf(text, statement, token) : builtInEdge(scheme, text)
    return weakest(`${name}, ${scheme}`, [token('--surface-2')], edge)
  })
}

const glassSides = (() => {
  const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
  const dark = paletteOf(glassCss, 'dark', names)
  const light = paletteOf(glassCss, 'light', names)
  if (!dark || !light) throw new Error('glass.css no longer states both sides')
  return { dark, light } satisfies Sides
})()

/** What glass's frame can be: what is open - every accent as a note's mark and a page of
 *  every kind - over every material and none, at its dials' ends. */
function glass(): Seen[] {
  const pages: Rgb[] = [
    [255, 255, 255],
    [15, 15, 15],
    [128, 128, 128],
    [255, 0, 0],
    [29, 155, 240],
    [255, 235, 59],
  ]
  const materials: Material[] = [null, 'mica', 'acrylic', 'clear']
  const seen: Seen[] = []
  for (const app of SCHEMES) {
    const paper = colour(said(blockOf(TOKENS, app), '--bg'))
    const sources = [
      ...ACCENTS.map((one) => ({ colour: colour(one[app]), page: false })),
      ...pages.map((one) => ({ colour: one, page: true })),
    ]
    for (const material of materials) {
      for (const source of sources) {
        for (const opacity of [0, 1]) {
          const frame = frameFor(source, app, material, glassSides, paper, {
            opacity,
            strength: 1,
          })
          const tint = colour(frame.tint)
          const span = spanUnder(material, app, paper)
          const frames = through(span).map((under) => over(tint, frame.wash, under))
          const text = glassSides[frame.scheme].text
          seen.push(
            weakest(
              `glass, ${app}, ${material ?? 'no material'}, ${String(source.colour)}`,
              frames,
              builtInEdge(frame.scheme, text),
            ),
          )
        }
      }
    }
  }
  return seen
}

/** What wallpaper's frame can be: any picture at all, from under the least scrim its
 *  words allow - the floor the sheet holds every picture to - to under the Dim dial
 *  turned all the way, which is the scrim alone. */
function wallpaper(): Seen[] {
  const anything: Span = { least: [0, 0, 0], most: [255, 255, 255] }
  return SCHEMES.map((scheme) => {
    const side = paletteOf(wallpaperCss, scheme)
    if (!side) throw new Error(`wallpaper.css states no ${scheme} palette`)
    const floor = floorFor(side, anything)
    const frames = [...through(anything).map((under) => over(side.scrim, floor, under)), side.scrim]
    return weakest(`wallpaper, ${scheme}`, frames, builtInEdge(scheme, side.text))
  })
}

/** The declarations of the last rule `selector` opens in the strip's stylesheet. */
function rule(selector: string): string {
  const at = TABS.lastIndexOf(`\n  ${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return TABS.slice(at, TABS.indexOf('}', at))
}

describe('the open tab', () => {
  test('is cut out of the frame by an edge both sides state', () => {
    for (const scheme of SCHEMES) {
      expect(said(blockOf(TOKENS, scheme), '--tab-edge'), scheme).toBeDefined()
    }
    // Glass and wallpaper write in inks of their own, which the edge is a lift of.
    for (const scheme of SCHEMES) {
      expect(sheetColour(glassCss, scheme, '--text'), scheme).not.toBeNull()
      expect(sheetColour(wallpaperCss, scheme, '--text'), scheme).not.toBeNull()
    }
  })

  test.each([
    ['the built-in', () => opaque('built-in', null)],
    ['contrast', () => opaque('contrast', contrastCss)],
    ['glass', glass],
    ['wallpaper', wallpaper],
  ])('stands out of the frame in %s, on every frame it can stand on', (_name, seen) => {
    for (const one of seen()) expect(one.ratio, one.where).toBeGreaterThanOrEqual(FLOOR)
  })

  test("is edged in the strip's own words, and eased in with its fill", () => {
    expect(rule('.strip')).toMatch(/--tab-line: var\(--tab-edge\);/)
    expect(rule('.tab.active .edge')).toMatch(/border-color: var\(--tab-line\);/)
    expect(rule('.tab.active .edge')).toMatch(/transition: border-color var\(--dur-fast\)/)
    expect(rule('.tab.active .fill')).toMatch(/opacity var\(--dur-fast\) var\(--ease-out\)/)
    // The curve up each foot is the fill's, so it eases in with it.
    expect(TABS).toMatch(/var\(--tab-line\) calc\(var\(--tab-foot\) - 1px\)/)
    // The line either side of it is there at once, so the bar never blinks.
    expect(TABS).toMatch(/\.edge::after \{\s+content: '';[^}]*background: var\(--tab-line\);/)
  })
})
