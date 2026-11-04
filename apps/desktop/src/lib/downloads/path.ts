/** Where a download's flight starts and lands, and the path it takes between: the
 *  arithmetic of flight.ts, with everything it weighs handed in. See #1048. */

import type { Press } from './started'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  width: number
  height: number
}

/** A downloads glyph on screen, as `landing` weighs it. */
export interface Glyph {
  box: Box
  /** The web tab whose bar it is in. */
  tab: string | null
  /** Whether it is in the pane that has the focus. */
  focused: boolean
}

/** How long a press is still where a download came from: long enough for a save
 *  dialog to be read and answered. */
export const PRESS_LASTS = 60_000

/** How far in from the window's corner a flight with nowhere to land ends. */
const CORNER = 32

export function middleOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Where a flight starts. Pure: everything it weighs is handed in. */
export function startOf(asked: {
  /** The control it was asked for by, on screen. */
  element: Box | null
  /** The page saving it, for a web tab's download: where it starts, or its top edge. */
  page: Point | null
  press: Press | null
  /** The press's element, if it is still on screen. */
  pressed: Box | null
  now: number
  /** The panes, or the window. */
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

/** Which glyph a flight lands on, or null for none on screen. Pure. */
export function landing(glyphs: readonly Glyph[], tab: string | null): Glyph | null {
  return (
    (tab === null ? undefined : glyphs.find((one) => one.tab === tab)) ??
    glyphs.find((one) => one.focused) ??
    glyphs[0] ??
    null
  )
}

/** Where a flight with no glyph to land on ends: the corner at the end of the strip,
 *  which is the right on a page read left to right. Pure. */
export function cornerOf(window: { width: number; height: number }, rtl: boolean): Point {
  return { x: rtl ? CORNER : window.width - CORNER, y: CORNER }
}

/** How long a flight takes: 400 milliseconds across a glyph's width, 600 across a
 *  large window, and in between by the distance. Pure. */
export function flightMs(from: Point, to: Point): number {
  const far = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.round(400 + 200 * Math.min(1, far / 1200))
}

/** Leaves gently and settles gently: smoothstep. Pure. */
function eased(at: number): number {
  return at * at * (3 - 2 * at)
}

/** The points a flight passes through: a curve that rises above the higher of its two
 *  ends, by more the further it goes, with the time eased onto it. Pure. */
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

/** The frames a flight is played as: moved and, near the end, made small and faded
 *  into the glyph. Only a transform and an opacity. Pure. */
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
