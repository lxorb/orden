/** Which cell a dragged window is in, in All spaces (issue #331).
 *
 *  A window is always in exactly one space's cell, never between two or outside every
 *  one. Dragged towards the edge of its own it stays in it, and its bubble goes
 *  with it; dragged far enough into the room of another, it plops across. Far enough is
 *  further than the way back, so a hand resting on the line between two cells does not
 *  make the window flicker between them. Pure. */

import type { Box } from './layout'

export interface Cell {
  key: string
  box: Box
}

/** How far past a cell's windows the pointer is still in that cell, and how much further
 *  it must go into another before it plops there. */
const HOLDS = 110
const TAKES = 20

const within = (box: Box, x: number, y: number, by: number) =>
  x >= box.x - by && x <= box.x + box.w + by && y >= box.y - by && y <= box.y + box.h + by

/** The cell the pointer at `x`, `y` puts a window in, which was in `now`'s: `now` while
 *  the pointer is near enough to it, another cell once it is well inside that one's, and
 *  `now` again everywhere else. */
export function cellAt(cells: readonly Cell[], now: string, x: number, y: number): string {
  const own = cells.find((one) => one.key === now)
  if (own && within(own.box, x, y, HOLDS)) return now
  const other = cells.find((one) => one.key !== now && within(one.box, x, y, -TAKES))
  return other?.key ?? now
}
