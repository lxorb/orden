import type { Scheme } from '@orden/contracts'
import { accentColour } from '../../../theme/src/api'
import { luminance, over, type Rgb, rgbOf } from '../../../ui-controls/src/api'

export type Stops = readonly [Rgb, Rgb]

export interface Pair {
  id: string
  name: string
  light: readonly [string, string]
  dark: readonly [string, string]
}

export const DAWN: Pair = {
  id: 'dawn',
  name: 'Dawn',
  light: ['#d2e7fc', '#eed7f2'],
  dark: ['#1d2a3d', '#30243d'],
}

export const PAIRS: readonly Pair[] = [
  DAWN,
  { id: 'lagoon', name: 'Lagoon', light: ['#d1f0e7', '#d1dff9'], dark: ['#182d2c', '#1b273b'] },
  { id: 'lilac', name: 'Lilac', light: ['#e5dbf9', '#d5defa'], dark: ['#28233d', '#202840'] },
  { id: 'peach', name: 'Peach', light: ['#fce7d6', '#f5d6e2'], dark: ['#332623', '#32202e'] },
  { id: 'sage', name: 'Sage', light: ['#d3e5cf', '#efe3c6'], dark: ['#1f2b23', '#2b281f'] },
  { id: 'mist', name: 'Mist', light: ['#dfe5ec', '#e9e4ec'], dark: ['#232830', '#2b2730'] },
]

export const ACCENT_PAIR = 'accent'

const OWN = /^(#[0-9a-f]{6}) (#[0-9a-f]{6})$/

export function isOwn(value: unknown): value is string {
  return typeof value === 'string' && OWN.test(value)
}

export function ownOf(first: string, second: string): string {
  return `${first.toLowerCase()} ${second.toLowerCase()}`
}

const DEEP = 0.15

const TOO_LIGHT = 0.12

export function stopsOf(value: unknown, scheme: Scheme, accent: string, scrim: Rgb): Stops {
  if (value === ACCENT_PAIR) {
    const colour = rgbOf(accentColour(accent, scheme)) ?? scrim
    return [colour, colour]
  }

  const own = typeof value === 'string' ? OWN.exec(value) : null
  if (own) {
    const picked = [own[1], own[2]].map((one) => rgbOf(one ?? '') ?? scrim)
    const worn = picked.map((one) =>
      scheme === 'dark' && luminance(one) > TOO_LIGHT ? over(one, DEEP, scrim) : one,
    )
    return [worn[0] ?? scrim, worn[1] ?? scrim]
  }

  const pair = PAIRS.find((one) => one.id === value) ?? DAWN
  const [first, second] = pair[scheme]
  return [rgbOf(first) ?? scrim, rgbOf(second) ?? scrim]
}

export function shownOf(value: unknown, scheme: Scheme, accent: string): readonly [string, string] {
  if (value === ACCENT_PAIR) {
    const colour = accentColour(accent, scheme)
    return [colour, colour]
  }
  const own = typeof value === 'string' ? OWN.exec(value) : null
  if (own?.[1] && own[2]) return [own[1], own[2]]
  return (PAIRS.find((one) => one.id === value) ?? DAWN)[scheme]
}

const STEPS = 8

export function along(stops: Stops): Rgb[] {
  const [first, second] = stops
  return Array.from({ length: STEPS + 1 }, (_, step) => over(second, step / STEPS, first))
}

export function swatchOf(pair: Pair, scheme: Scheme): string {
  const [first, second] = pair[scheme]
  return `linear-gradient(135deg, ${first}, ${second})`
}
