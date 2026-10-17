/** Where somebody else's hand is drawn when it is not on the screen.
 *
 *  A hand off the screen used to be drawn where it was, which is nowhere anybody can
 *  see: a phone and a desktop in one canvas, each looking at a different corner of it,
 *  saw nobody (#386). So a hand out of view is held at the nearest point of the
 *  screen's edge, with an arrow that points the way to it and its name beside the
 *  arrow, on the inside. Moving towards the arrow brings it into view, and the arrow
 *  goes where the hand comes in.
 *
 *  Pure: the plane's camera and the surface's size in, plane units out, because the
 *  layer it is drawn on is inside the plane's own transform. */

import type { Camera } from '../camera'
import type { Point } from './geometry'

/** How far in from each edge a held hand sits, in screen pixels. More at the foot,
 *  where the canvas's bar is: a hand held under it would be a hand nobody can see. */
export const INSET = { top: 18, right: 18, bottom: 76, left: 18 } as const

/** How far past the edge a hand may be and still be drawn where it is: its dot is
 *  four pixels across, so one that close is still on the screen. */
const STILL_SHOWN = 4

/** A hand held at the edge: where it is drawn, in plane units, which way it is, in
 *  degrees clockwise from pointing right, and which side of the arrow its name goes
 *  on, as SVG's own words for it. */
export interface Held {
  at: Point
  angle: number
  anchor: 'start' | 'middle' | 'end'
  baseline: 'auto' | 'middle' | 'hanging'
}

/** Null for a hand on the screen, which is drawn where it is. */
export function heldAtEdge(at: Point, camera: Camera, width: number, height: number): Held | null {
  if (width <= 0 || height <= 0) return null

  const x = width / 2 + (at.x - camera.x) * camera.scale
  const y = height / 2 + (at.y - camera.y) * camera.scale

  const shown =
    x >= -STILL_SHOWN && x <= width + STILL_SHOWN && y >= -STILL_SHOWN && y <= height + STILL_SHOWN
  if (shown) return null

  // The nearest point of the inset frame. A frame too small to have an inside - a
  // surface narrower than its own margins - is its middle.
  const left = Math.min(INSET.left, width / 2)
  const right = Math.max(width - INSET.right, width / 2)
  const top = Math.min(INSET.top, height / 2)
  const bottom = Math.max(height - INSET.bottom, height / 2)
  const heldX = Math.min(right, Math.max(left, x))
  const heldY = Math.min(bottom, Math.max(top, y))

  const dx = x - heldX
  const dy = y - heldY
  const length = Math.hypot(dx, dy) || 1
  const across = dx / length
  const down = dy / length

  return {
    at: {
      x: camera.x + (heldX - width / 2) / camera.scale,
      y: camera.y + (heldY - height / 2) / camera.scale,
    },
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    // The name on the far side of the arrow from the edge, so it reads inside the
    // screen rather than off it.
    anchor: across > 0.4 ? 'end' : across < -0.4 ? 'start' : 'middle',
    baseline: down > 0.4 ? 'auto' : down < -0.4 ? 'hanging' : 'middle',
  }
}
