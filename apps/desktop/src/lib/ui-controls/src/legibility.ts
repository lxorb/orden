export type Rgb = readonly [number, number, number]

export const AA = 4.5

export const SHARP = 6

export function rgbOf(said: string): Rgb | null {
  const text = said.trim().toLowerCase()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1]
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
    return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as unknown as Rgb
  }

  const parts = /^rgba?\(([^)]*)\)$/
    .exec(text)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)
  if (!parts || parts.length < 3) return null

  const channels = parts.slice(0, 3).map(Number)
  if (channels.some((one) => !Number.isFinite(one))) return null
  return channels.map((one) => Math.min(255, Math.max(0, one))) as unknown as Rgb
}

export function hexOf(colour: Rgb): string {
  return `#${colour.map((one) => Math.round(one).toString(16).padStart(2, '0')).join('')}`
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function ratio(one: Rgb, two: Rgb): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

export function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const [r, g, b] = top
  const [r0, g0, b0] = under
  return [r * alpha + r0 * (1 - alpha), g * alpha + g0 * (1 - alpha), b * alpha + b0 * (1 - alpha)]
}

export function inkFor(ground: Rgb, inks: readonly Rgb[]): Rgb {
  const scored = inks.map((ink) => ({ ink, score: ratio(ink, ground) }))
  const enough = scored.find((one) => one.score >= AA)
  if (enough) return enough.ink

  return scored.reduce((best, one) => (one.score > best.score ? one : best)).ink
}

export interface Span {
  least: Rgb
  most: Rgb
}

export interface Lift {
  colour: Rgb
  alpha: number
}

export function scrimFloor(
  ink: Rgb,
  scrim: Rgb,
  span: Span,
  lifts: readonly Lift[] = [],
  floor = AA,
): number {
  const own = luminance(ink)
  const reads = (alpha: number) => {
    const grounds = [span.least, span.most].map((under) =>
      lifts.reduce(
        (below, lift) => over(lift.colour, lift.alpha, below),
        over(scrim, alpha, under),
      ),
    )
    const sides = new Set(grounds.map((ground) => luminance(ground) > own))
    return sides.size === 1 && grounds.every((ground) => ratio(ink, ground) >= floor)
  }

  if (!reads(1)) return 1
  if (reads(0)) return 0

  let low = 0
  let high = 100
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (reads(middle / 100)) high = middle
    else low = middle
  }

  return high / 100
}
