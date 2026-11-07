import { AA, type Lift, over, type Rgb, rgbOf, scrimFloor, type Span } from '../legibility'

export interface Palette {
  ink: Rgb
  scrim: Rgb
  layer: Lift
  text: Rgb
}

const INK = 0.08
const SCRIM = 0.4

function stacks(palette: Palette): Lift[][] {
  const hover = {
    colour: over(palette.text, INK / (INK + SCRIM), palette.scrim),
    alpha: INK + SCRIM,
  }
  return [[], [hover], [palette.layer], [palette.layer, hover]]
}

function blockOf(css: string, scheme: 'dark' | 'light'): string {
  const head = new RegExp(String.raw`\[data-theme=['"]?${scheme}['"]?\]\s*\{`).exec(css)
  if (!head) return ''
  const from = head.index + head[0].length
  return css.slice(from, css.indexOf('}', from))
}

function tokenIn(block: string, name: string): string {
  return new RegExp(String.raw`${name}\s*:\s*([^;]+);`).exec(block)?.[1]?.trim() ?? ''
}

export function sheetColour(css: string, scheme: 'dark' | 'light', name: string): Rgb | null {
  return rgbOf(tokenIn(blockOf(css, scheme), name))
}

export interface Names {
  scrim: string
  layer: string
}

const WALLPAPER: Names = { scrim: '--wallpaper-scrim', layer: '--wallpaper-layer' }

export function paletteOf(
  css: string,
  scheme: 'dark' | 'light',
  names: Names = WALLPAPER,
): Palette | null {
  const block = blockOf(css, scheme)
  const ink = rgbOf(tokenIn(block, '--muted'))
  const text = rgbOf(tokenIn(block, '--text'))
  const scrim = rgbOf(tokenIn(block, names.scrim))
  const layerSaid = tokenIn(block, names.layer)
  const layer = rgbOf(layerSaid)
  const alpha = Number(/\/\s*([\d.]+)\s*\)$/.exec(layerSaid)?.[1] ?? 1)
  if (!ink || !text || !scrim || !layer || !Number.isFinite(alpha)) return null

  return { ink, text, scrim, layer: { colour: layer, alpha } }
}

export function floorFor(palette: Palette, span: Span, aim = AA): number {
  return stacks(palette)
    .map((lifts) => scrimFloor(palette.ink, palette.scrim, span, lifts, aim))
    .reduce((high, one) => Math.max(high, one), -Infinity)
}
