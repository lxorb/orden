import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { contrastCss } from '@orden/themes/contrast'
import { glassCss } from '@orden/themes/glass'
import { wallpaperCss } from '@orden/themes/wallpaper'
import { describe, expect, test } from 'vitest'
import { ACCENTS } from '../src/lib/accents'
import { frameFor, type Material, type Scheme, type Sides, spanUnder } from '../src/lib/glass/tint'
import { over, ratio, type Rgb, rgbOf, type Span } from '../src/lib/legibility'
import { floorFor, paletteOf, sheetColour } from '../src/lib/wallpaper/floors'

const FLOOR = 1.5

const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)
const TABS = readFileSync(join(import.meta.dirname, '../src/lib/Tabs.svelte'), 'utf8')

const SCHEMES: Scheme[] = ['dark', 'light']

function colour(said: string | undefined): Rgb {
  const found = rgbOf(said ?? '')
  if (!found) throw new Error(`not a colour: ${said}`)
  return found
}

function blockOf(css: string, scheme: Scheme): string {
  const head = new RegExp(String.raw`\[data-theme=['"]?${scheme}['"]?\]\s*\{`).exec(css)
  if (!head) return ''
  const from = head.index + head[0].length
  return css.slice(from, css.indexOf('\n}', from))
}

function said(block: string, name: string): string | undefined {
  return new RegExp(String.raw`${name}\s*:\s*([^;]+);`).exec(block)?.[1]?.trim()
}

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

function builtInEdge(scheme: Scheme, text: Rgb): Edge {
  const statement = said(blockOf(TOKENS, scheme), '--tab-edge')
  if (!statement) throw new Error(`tokens.css states no --tab-edge on the ${scheme} side`)
  return edgeOf(text, statement, (name) => colour(said(blockOf(TOKENS, scheme), name)))
}

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

function weakest(where: string, frames: Rgb[], edge: Edge): Seen {
  return frames
    .map((frame) => ({ where, ratio: ratio(edge(frame), frame) }))
    .reduce((least, one) => (one.ratio < least.ratio ? one : least))
}

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
    expect(rule('.strip')).toMatch(/--tab-line: var\(--strip-line, var\(--tab-edge\)\);/)
    expect(rule('.tab.active .edge')).toMatch(/border-color: var\(--tab-line\);/)
    expect(rule('.tab.active .edge')).toMatch(/transition: border-color var\(--dur-fast\)/)
    expect(rule('.tab.active .fill')).toMatch(/opacity var\(--dur-fast\) var\(--ease-out\)/)
    expect(TABS).toMatch(/var\(--tab-line\) calc\(var\(--tab-foot\) - 1px\)/)
    expect(TABS).toMatch(/\.edge::after \{\s+content: '';[^}]*background: var\(--tab-line\);/)
  })

  test('with nothing ahead of it, stands at its pane’s edge with no foot there (#1139)', () => {
    expect(TABS).toMatch(/const lead = \$derived\(flush \? 0 : LEAD\)/)
    expect(TABS).toContain('style:--lead="{lead}px"')
    expect(rule('.tabs.flush .tab.first .fill')).toMatch(/inset-inline-start: 0;/)
    expect(TABS).toMatch(
      /:global\(:root:not\(\[dir='rtl'\]\)\) \.tabs\.flush \.tab\.first\.active \.fill::before,\s+:global\(:root\[dir='rtl'\]\) \.tabs\.flush \.tab\.first\.active \.fill::after \{\s+display: none;/,
    )
    const pane = readFileSync(join(import.meta.dirname, '../src/lib/Pane.svelte'), 'utf8')
    expect(pane).toContain('class:straight={!stripped && flushFirst(pane.id)}')
    expect(pane).toMatch(/\.pane\.straight \{\s+border-start-start-radius: 0;/)
  })
})
