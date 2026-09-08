/** Where a tab or a note being dragged over a pane would land: in the middle of
 *  it, which takes the tab in, or against one of its four sides, which makes a
 *  pane there.
 *
 *  Geometry and nothing else, so the zones can be read off a rectangle in a test
 *  rather than off a running window. Which sides are on offer is asked of the
 *  caller, since how far a pane may still split is the tree's business next door
 *  in pane-tree.ts: a zone that would do nothing is not offered rather than
 *  taking the drop and doing nothing with it. */

import type { Along } from './pane-tree'

export type Side = 'left' | 'right' | 'top' | 'bottom'

/** One of the four sides of a pane, or the pane itself. */
export type Zone = Side | 'middle'

/** The sides, in the order they are asked about. The order decides nothing but
 *  the answer in the corner of a square pane, where two of them are exactly as
 *  deep as each other. */
const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom']

/** Anything with a rectangle. A `DOMRect` is one. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** How far into a side a drop has to be held to make a pane there rather than
 *  join the pane's strip. A share of the pane, so it is the same band to aim at
 *  whatever size the window is. */
export const EDGE = 0.28

/** The direction a pane splits in to make room on that side. */
export function alongOf(side: Side): Along {
  return side === 'left' || side === 'right' ? 'row' : 'column'
}

/** Whether a pane made against that side takes the first place in the split:
 *  left of, or above, the pane it was dropped on. */
export function madeFirst(side: Side): boolean {
  return side === 'left' || side === 'top'
}

/** How far past a side's edge the point is, as a share of the box, and zero or
 *  less when it is not in that side's band at all. */
function depth(box: Box, side: Side, x: number, y: number): number {
  const across = (x - box.left) / box.width
  const down = (y - box.top) / box.height

  switch (side) {
    case 'left':
      return EDGE - across
    case 'right':
      return across - (1 - EDGE)
    case 'top':
      return EDGE - down
    case 'bottom':
      return down - (1 - EDGE)
  }
}

/** Which zone of a pane a point is in. The corner belongs to whichever side it
 *  is further into, and a side the caller does not offer is passed over: in a
 *  corner the other side takes it, and anywhere else it reads as the middle. */
export function zoneAt(box: Box, x: number, y: number, offered: (side: Side) => boolean): Zone {
  let zone: Zone = 'middle'
  let deepest = 0

  for (const side of SIDES) {
    const into = depth(box, side, x, y)
    if (into > deepest && offered(side)) {
      zone = side
      deepest = into
    }
  }

  return zone
}

/** Whether the point is in the box at all.
 *
 *  What tells a drag leaving something from one moving onto a child of it:
 *  `dragleave` fires for both, and the off-on-off of the second is the flicker.
 *  Only geometry can say which happened. */
export function inside(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
}
