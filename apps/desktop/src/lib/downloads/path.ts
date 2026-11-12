import type { Press } from './started'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  width: number
  height: number
}

export interface Glyph {
  box: Box
  tab: string | null
  focused: boolean
}

export const PRESS_LASTS = 60_000

const CORNER = 32

export function middleOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function startOf(asked: {
  element: Box | null
  page: Point | null
  press: Press | null
  pressed: Box | null
  now: number
  area: Box
}): Point {
  if (asked.element) return middleOf(asked.element)
  if (asked.page) return asked.page

  const press = asked.press
  if (press && asked.now - press.at <= PRESS_LASTS) {
    if (asked.pressed) return middleOf(asked.pressed)
    if (press.x !== null && press.y !== null) return { x: press.x, y: press.y }
  }
  return middleOf(asked.area)
}

export function landing(glyphs: readonly Glyph[], tab: string | null): Glyph | null {
  return (
    (tab === null ? undefined : glyphs.find((one) => one.tab === tab)) ??
    glyphs.find((one) => one.focused) ??
    glyphs[0] ??
    null
  )
}

export function cornerOf(window: { width: number; height: number }): Point {
  return { x: window.width - CORNER, y: CORNER }
}

export function flightMs(from: Point, to: Point): number {
  const far = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.round(400 + 200 * Math.min(1, far / 1200))
}

function eased(at: number): number {
  return at * at * (3 - 2 * at)
}

export function arcOf(from: Point, to: Point, steps = 16): Point[] {
  const far = Math.hypot(to.x - from.x, to.y - from.y)
  const lift = Math.min(160, Math.max(40, far * 0.3))
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift }

  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = eased(index / steps)
    const rest = 1 - at
    return {
      x: rest * rest * from.x + 2 * rest * at * control.x + at * at * to.x,
      y: rest * rest * from.y + 2 * rest * at * control.y + at * at * to.y,
    }
  })
}

export function framesOf(from: Point, to: Point, landed: boolean): Keyframe[] {
  const points = arcOf(from, to)
  const last = points.length - 1
  return points.map((point, index) => {
    const at = index / last
    const scale = at < 0.7 ? 1 : 1 - ((at - 0.7) / 0.3) * (landed ? 0.5 : 0.7)
    const opacity = at < 0.8 ? 1 : Math.round((1 - (at - 0.8) / 0.2) * 100) / 100
    return {
      offset: at,
      transform: `translate(${String(point.x - from.x)}px, ${String(point.y - from.y)}px) scale(${String(scale)})`,
      opacity: String(index === 0 ? 0 : opacity),
    }
  })
}
