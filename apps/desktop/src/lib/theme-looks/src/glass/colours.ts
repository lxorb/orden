import { luminance, type Rgb, rgbOf } from '../../../ui-controls/src/api'

export interface PageSaid {
  theme: string
  top: string[]
  pictured: boolean
}

const SOLID = 0.9

const SAME = 12

export function solid(said: string): Rgb | null {
  const text = said.trim().toLowerCase()
  const colour = rgbOf(text)
  if (!colour) return null

  const alpha = /^rgba?\([^)]*[,/]\s*([\d.]+%?)\s*\)$/.exec(text)?.[1]
  if (alpha === undefined) return colour
  const value = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
  return Number.isFinite(value) && value >= SOLID ? colour : null
}

function near(one: Rgb, two: Rgb): boolean {
  return one.every((channel, at) => Math.abs(channel - (two[at] ?? 0)) <= SAME)
}

export function agreed(readings: readonly (Rgb | null)[]): Rgb | null {
  const found = readings.filter((one): one is Rgb => one !== null)
  const middle = readings[Math.floor(readings.length / 2)] ?? null
  const ordered = middle ? [middle, ...found] : found
  for (const one of ordered) {
    if (found.filter((other) => near(one, other)).length * 2 > readings.length) return one
  }
  return null
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

const GREY = 32

const MIDDLE = 0.179

function light(colour: Rgb): boolean {
  return luminance(colour) > MIDDLE
}

function stale(named: Rgb, top: Rgb): boolean {
  return chroma(...named) < GREY && light(named) !== light(top)
}

export function groundSaid(said: PageSaid): Rgb | null {
  const named = solid(said.theme)
  const top = said.pictured ? null : agreed(said.top.map(solid))
  if (!named) return top
  return top && stale(named, top) ? top : named
}

export type Pixels = ArrayLike<number>

function bucketOf(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
}

interface Tally {
  weight: number
  r: number
  g: number
  b: number
  count: number
}

function heaviest(
  pixels: Pixels,
  weigh: (r: number, g: number, b: number) => number,
): { colour: Rgb; share: number } | null {
  const tallies = new Map<number, Tally>()
  let counted = 0

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if ((pixels[at + 3] ?? 0) < 128) continue
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    const weight = weigh(r, g, b)
    counted++
    if (weight <= 0) continue

    const key = bucketOf(r, g, b)
    const tally = tallies.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, count: 0 }
    tally.weight += weight
    tally.r += r
    tally.g += g
    tally.b += b
    tally.count++
    tallies.set(key, tally)
  }

  let best: Tally | null = null
  for (const tally of tallies.values()) if (!best || tally.weight > best.weight) best = tally
  if (!best || counted === 0) return null

  return {
    colour: [best.r / best.count, best.g / best.count, best.b / best.count].map(Math.round) as [
      number,
      number,
      number,
    ],
    share: best.count / counted,
  }
}

export function dominant(pixels: Pixels): Rgb | null {
  const coloured = heaviest(pixels, (r, g, b) => {
    const spread = chroma(r, g, b)
    return spread < GREY ? 0 : spread
  })
  return coloured?.colour ?? heaviest(pixels, () => 1)?.colour ?? null
}

const MOSTLY = 0.6

export function stripGround(pixels: Pixels): Rgb | null {
  const most = heaviest(pixels, () => 1)
  if (!most) return null
  return most.share >= MOSTLY ? most.colour : average(pixels)
}

function average(pixels: Pixels): Rgb | null {
  const sum = [0, 0, 0]
  let counted = 0
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if ((pixels[at + 3] ?? 0) < 128) continue
    for (const channel of [0, 1, 2])
      sum[channel] = (sum[channel] ?? 0) + (pixels[at + channel] ?? 0)
    counted++
  }
  if (counted === 0) return null
  return [0, 1, 2].map((channel) => Math.round((sum[channel] ?? 0) / counted)) as [
    number,
    number,
    number,
  ]
}
