import {
  alphaFor,
  type ContentLevel,
  layered,
  type PaperInks,
  paperFloor,
  percent,
} from '../../../content-ground'
import { AA, hexOf, over, type Rgb, rgbOf, SHARP, type Span } from '../../../legibility'
import { floorFor, type Palette } from './floors'
import type { Scheme } from '@orden/contracts'
import type { Held } from './held'

export const FITS = ['fill', 'fit', 'tile', 'centre'] as const
export type Fit = (typeof FITS)[number]

export interface Dials {
  blur: number
  dim: number
  grain: number
  fit: Fit
  empty: boolean
  content: ContentLevel
}

export interface Colours {
  palette: Palette
  inks: PaperInks
  field: Span
}

const GRAIN_MOST = 0.16

const SOFT = 16

export function aimFor(blur: number): number {
  return AA + (SHARP - AA) * Math.max(0, 1 - blur / SOFT)
}

export function grained(span: Span, grain: number): Span {
  const alpha = (Math.min(100, Math.max(0, grain)) / 100) * GRAIN_MOST
  if (alpha <= 0) return span
  return {
    least: over([0, 0, 0], alpha, span.least),
    most: over([255, 255, 255], alpha, span.most),
  }
}

const ANY: Span = { least: [0, 0, 0], most: [255, 255, 255] }

export interface Floors {
  chrome: number
  paper: number
  terminal: number
  ground: string
}

export function floorsOf(
  held: Held | null,
  scheme: Scheme,
  dials: Pick<Dials, 'blur' | 'grain'>,
  colours: Colours,
  fieldFloor: number,
): Floors {
  const { palette, inks } = colours
  const known = held?.span
  const span = grained(known ?? (held ? ANY : colours.field), dials.grain)
  const aim = held ? aimFor(dials.blur) : AA
  const chrome = held
    ? known
      ? floorFor(palette, span, aim)
      : (held[scheme]?.floor ?? floorFor(palette, span, aim))
    : Math.max(fieldFloor, floorFor(palette, span, aim))

  const under: Span = {
    least: over(palette.scrim, chrome, span.least),
    most: over(palette.scrim, chrome, span.most),
  }
  const mean = rgbOf(held?.mean ?? '') ?? middle(span)

  return {
    chrome,
    paper: paperFloor(inks, under),
    terminal: paperFloor(inks, under, true),
    ground: hexOf(over(palette.scrim, chrome, mean)),
  }
}

function middle(span: Span): Rgb {
  return [0, 1, 2].map((at) => ((span.least[at] ?? 0) + (span.most[at] ?? 0)) / 2) as unknown as Rgb
}

export function placement(
  held: Held | null,
  fit: Fit,
): { size: string; position: string; repeat: string } {
  const [x, y] = held?.focus ?? [0.5, 0.5]
  const at = `${percentOf(x)} ${percentOf(y)}`
  const size = held?.size

  if (fit === 'fit') return { size: 'contain', position: at, repeat: 'no-repeat' }
  if (fit === 'tile' && size) {
    return { size: `${size[0]}px ${size[1]}px`, position: '0 0', repeat: 'repeat' }
  }
  if (fit === 'centre' && size) {
    const [width, height] = size
    return {
      size: `${width}px ${height}px`,
      position: `calc(50% - ${Math.round(x * width)}px) calc(50% - ${Math.round(y * height)}px)`,
      repeat: 'no-repeat',
    }
  }
  return { size: 'cover', position: at, repeat: 'no-repeat' }
}

function percentOf(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

export function grainOf(grain: number): string {
  const alpha = (Math.min(100, Math.max(0, grain)) / 100) * GRAIN_MOST
  if (alpha <= 0) return 'none'
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='192' height='192'>" +
    "<filter id='n' color-interpolation-filters='sRGB'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix type='saturate' values='0'/>" +
    '<feComponentTransfer>' +
    "<feFuncR type='linear' slope='2.2' intercept='-.6'/>" +
    "<feFuncG type='linear' slope='2.2' intercept='-.6'/>" +
    "<feFuncB type='linear' slope='2.2' intercept='-.6'/>" +
    `<feFuncA type='linear' slope='0' intercept='${alpha.toFixed(3)}'/>` +
    '</feComponentTransfer></filter>' +
    "<rect width='100%' height='100%' filter='url(%23n)'/></svg>"
  return `url("data:image/svg+xml,${svg.replaceAll('<', '%3C').replaceAll('>', '%3E')}")`
}

function pictureLines(held: Held | null, fit: Fit): string[] {
  const place = placement(held, fit)
  return [
    ...(held ? [`--wallpaper-picture: url("${held.picture}");`] : []),
    ...(held?.mean ? [`--wallpaper-mean: ${held.mean};`] : []),
    `--wallpaper-size: ${place.size};`,
    `--wallpaper-position: ${place.position};`,
    `--wallpaper-repeat: ${place.repeat};`,
  ]
}

export function picturesRule(pictures: { light: Held | null; dark: Held | null }): string {
  const floors = (['dark', 'light'] as const).flatMap((scheme) => {
    const held = scheme === 'dark' ? (pictures.dark ?? pictures.light) : pictures.light
    const side = held?.[scheme]
    return side
      ? [
          `--wallpaper-floor-${scheme}: ${percent(side.floor)};`,
          `--wallpaper-ground-${scheme}: ${side.ground};`,
        ]
      : []
  })
  return block(':root', [...pictureLines(pictures.light, 'fill'), ...floors])
}

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((line) => `  ${line}\n`).join('')}}\n`
}

export function wallpaperRule(
  pictures: { light: Held | null; dark: Held | null },
  dials: Dials,
  colours: Record<Scheme, Colours>,
  fieldFloors: Record<Scheme, number>,
): string {
  const root: string[] = [
    ...pictureLines(pictures.light, dials.fit),
    `--wallpaper-grain: ${grainOf(dials.grain)};`,
    `--orden-dim: ${dials.dim}%;`,
    `--empty-ground: ${dials.empty ? 'transparent' : 'var(--content-ground)'};`,
    ...(dials.content === 'opaque' ? [] : ['--content-inner: transparent;']),
  ]

  for (const scheme of ['dark', 'light'] as const) {
    const held = scheme === 'dark' ? (pictures.dark ?? pictures.light) : pictures.light
    const floors = floorsOf(held, scheme, dials, colours[scheme], fieldFloors[scheme])
    const paper = alphaFor(dials.content, floors.paper)
    const terminal = layered(alphaFor(dials.content, floors.terminal), paper)
    root.push(
      `--wallpaper-floor-${scheme}: ${percent(floors.chrome)};`,
      `--wallpaper-ground-${scheme}: ${floors.ground};`,
      `--wallpaper-paper-${scheme}: ${percent(paper)};`,
      `--wallpaper-terminal-${scheme}: ${percent(terminal)};`,
    )
  }

  const dark = pictures.dark
    ? block(":root[data-theme='dark']", pictureLines(pictures.dark, dials.fit))
    : ''
  return `${block(':root', root)}${dark}`
}
