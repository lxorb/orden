import { AA, luminance, over, type Rgb, scrimFloor, type Span } from './legibility'

export const CONTENT_LEVELS = ['opaque', 'tinted', 'clear'] as const
export type ContentLevel = (typeof CONTENT_LEVELS)[number]

export const CONTENT_INITIAL: ContentLevel = 'tinted'

export interface PaperInks {
  bg: Rgb
  text: Rgb
  muted: Rgb
  link: Rgb
}

export const BODY = 7

export const TERMINAL_CONTRAST = 5.5

const HAIR = 0.1

export function linkOf(accent: Rgb, strong: Rgb): Rgb {
  return over(accent, 0.7, strong)
}

function greyAt(target: number): Rgb {
  let low = 0
  let high = 255
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2
    if (luminance([middle, middle, middle]) < target) low = middle
    else high = middle
  }
  const level = (low + high) / 2
  return [level, level, level]
}

function terminalInk(bg: Rgb): Rgb {
  const paper = luminance(bg)
  const dark = paper < 0.5
  const target = dark
    ? (paper + 0.05) * TERMINAL_CONTRAST - 0.05
    : (paper + 0.05) / TERMINAL_CONTRAST - 0.05
  return greyAt(Math.min(1, Math.max(0, target)))
}

export function paperFloor(inks: PaperInks, span: Span, terminal = false): number {
  const aims: [Rgb, number][] = [
    [inks.text, BODY],
    [inks.muted, AA],
    [inks.link, AA],
    ...(terminal ? [[terminalInk(inks.bg), AA] as [Rgb, number]] : []),
  ]
  return Math.max(...aims.map(([ink, aim]) => scrimFloor(ink, inks.bg, span, [], aim + HAIR)))
}

export function alphaFor(level: ContentLevel, floor: number): number {
  if (level === 'opaque') return 1
  if (level === 'clear') return floor
  return Math.ceil(((1 + floor) / 2) * 100) / 100
}

export function layered(total: number, under: number): number {
  if (under >= 1) return 1
  return Math.ceil((Math.max(0, total - under) / (1 - under)) * 100) / 100
}

export function percent(alpha: number): string {
  return `${Math.round(alpha * 100)}%`
}
