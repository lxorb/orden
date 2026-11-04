/** Where each space lies on the overview's one canvas, kept across runs (issue #331).
 *
 *  Emil, 2026-11-03: there is one such view, one layout for every space, and where each
 *  space's windows sit, absolutely and against the others, is kept; opening and closing
 *  the view never resets it, and only the camera it starts from differs, on the space
 *  being worked in. So a space is given a place the first time the view shows it - to
 *  the right of every space placed before it - and keeps it. What lies inside a place is
 *  the space's panes and tabs, laid out from them (layout.ts); a place is where that
 *  starts, and how much room it was given.
 *
 *  Kept on this device, under `KEY`, through stored.ts. */

import { keepJson, stored } from '../stored'
import type { Box } from './layout'

const KEY = 'nib:overview-places'

/** The room between two spaces' places. */
const APART = 360

/** The places as written, with anything that is not one left out. */
export function readPlaces(value: unknown): Record<string, Box> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, Box> = {}
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one !== 'object' || one === null) continue
    const { x, y, w, h } = one as Record<string, unknown>
    const numbers = [x, y, w, h]
    if (numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out[key] = { x: x as number, y: y as number, w: w as number, h: h as number }
    }
  }
  return out
}

/** Where a space not placed yet goes: right of every other, level with the first. */
export function nextPlace(all: Record<string, Box>, size: { w: number; h: number }): Box {
  const placed = Object.values(all)
  if (!placed.length) return { x: 0, y: 0, ...size }
  const right = Math.max(...placed.map((one) => one.x + one.w))
  const top = Math.min(...placed.map((one) => one.y))
  return { x: right + APART, y: top, ...size }
}

class Places {
  private all = $state.raw<Record<string, Box>>(readPlaces(stored(KEY)))

  /** The place of `space`, or null before it has one. */
  at(space: string): Box | null {
    return this.all[space] ?? null
  }

  /** Gives `space` a place `size` big, unless it has one. Never from inside a derived:
   *  it writes. */
  place(space: string, size: { w: number; h: number }): Box {
    const known = this.all[space]
    if (known) return known
    const made = nextPlace(this.all, size)
    this.all = { ...this.all, [space]: made }
    keepJson(KEY, this.all)
    return made
  }
}

export const places = new Places()
