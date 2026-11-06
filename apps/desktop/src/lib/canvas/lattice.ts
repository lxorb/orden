import { GRID } from './geometry'

const THINS_AT = 12

const FILLS_AT = 15

const MOST = 32

const FAINTEST = 0.004

export function latticeEvery(level: number): number {
  return GRID * 2 ** level
}

export function latticeLevel(scale: number, held = 0): number {
  let level = Number.isFinite(held) ? Math.min(MOST, Math.max(0, Math.round(held))) : 0

  if (!(scale > 0) || !Number.isFinite(scale)) return level

  const finest = GRID * scale

  while (level < MOST && finest * 2 ** level < THINS_AT) level++
  while (level > 0 && finest * 2 ** (level - 1) >= FILLS_AT) level--

  return level
}

export interface Fade {
  at: number
  from: number
  to: number
  gone: number
}

export function settled(level: number): Fade {
  const at = Math.max(0, level)
  return { at, from: at, to: at, gone: 0 }
}

export function aimed(fade: Fade, to: number): Fade {
  const level = Math.max(0, to)
  if (level === fade.to) return fade

  return { at: fade.at, from: fade.at, to: level, gone: 0 }
}

export function fading(fade: Fade): boolean {
  return fade.at !== fade.to
}

export function stepped(fade: Fade, dt: number, ms: number): Fade {
  if (!fading(fade)) return fade

  const gone = fade.gone + Math.max(0, dt)
  if (!(ms > 0) || gone >= ms) return settled(fade.to)

  const through = gone / ms
  const eased = 1 - (1 - through) ** 3

  return { at: fade.from + (fade.to - fade.from) * eased, from: fade.from, to: fade.to, gone }
}

export interface LatticeLayer {
  every: number
  step: number
  showing: number
}

function tile(level: number, scale: number, showing: number): LatticeLayer {
  const every = latticeEvery(level)
  return { every, step: every * scale, showing }
}

export function latticeLayers(at: number, scale: number): LatticeLayer[] {
  if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(at)) return []

  const stands = Math.min(MOST, Math.max(0, at))
  const coarse = Math.ceil(stands)
  const showing = coarse - stands

  const layers = [tile(coarse, scale, 1)]
  if (coarse > 0 && showing > FAINTEST) layers.push(tile(coarse - 1, scale, showing))

  return layers
}
