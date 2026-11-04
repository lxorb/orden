/** Which cell a dragged window is in, in All spaces (issue #331).
 *
 *  A window is always in exactly one space's cell, never between two or outside every
 *  one. It is in the cell whose windows, as they lie at rest, its pointer is nearest - a
 *  cell of one small window is as easy to point into as one of twenty, and a pointer on
 *  a window is in that window's cell - of those whose bubble (`grownOf`) the pointer is
 *  on or within reach of. The cell it is in counts a little nearer than it is, so a hand
 *  resting on the line between two cells does not make the window flicker between them.
 *  The reach and the hold are lengths on the screen, the same at every zoom. Pure. */

import { grownOf } from './bubble'
import type { Box } from './layout'

export interface Cell {
  key: string
  box: Box
}

/** On the screen: how far past a cell's bubble the pointer still points into the cell,
 *  and how much nearer another cell must be than the one the window is in before it
 *  plops across. */
export const REACH = 72
const HOLD = 24

/** How far a point is from a box: outside it, the distance to it; inside it, how deep
 *  it is, as less than nothing. */
function from(box: Box, x: number, y: number): number {
  const dx = Math.max(box.x - x, x - (box.x + box.w))
  const dy = Math.max(box.y - y, y - (box.y + box.h))
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
}

/** The cell the pointer at `x`, `y` on the canvas puts a window in, which was in
 *  `now`'s, with the camera at `zoom`: one whose windows the pointer is among, `now`
 *  first; else of the cells whose bubble is within reach, the one whose windows are
 *  nearest, `now` winning a near thing; `now` where none is in reach. */
export function cellAt(
  cells: readonly Cell[],
  now: string,
  x: number,
  y: number,
  zoom = 1,
): string {
  const reach = REACH / zoom
  const hold = HOLD / zoom
  let best = now
  let nearest = Number.POSITIVE_INFINITY
  for (const cell of cells) {
    if (from(grownOf(cell.box), x, y) > reach) continue
    const far = from(cell.box, x, y)
    // Among its windows, which no hold of another's outweighs.
    const counted =
      far <= 0 ? (cell.key === now ? -Infinity : far - 1e9) : far - (cell.key === now ? hold : 0)
    if (counted < nearest) {
      best = cell.key
      nearest = counted
    }
  }
  return best
}
