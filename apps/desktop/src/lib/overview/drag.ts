/** A window dragged on the overview's canvas, and where it would land (issue #331).
 *
 *  Where it lands is read off the canvas as it would be without it: the window under
 *  the pointer, or the nearest, and which half of it the pointer is over. That canvas
 *  does not move while the hand does, so the answer does not flicker between two places
 *  as the others make room. The others are then laid out with the dragged one already
 *  in its new place, which is how they make room. Pure. */

import { type Frame, pane, withSplit } from '../workspace/pane-tree'
import { alongOf, madeFirst, type Side } from '../workspace/zones'
import { around, type Room, type Slot } from './layout'

/** Where a dragged tab would go: into a pane's strip, before a tab of it or at its end;
 *  or against a side of a pane, where it makes a pane of its own; or, in All spaces, into
 *  another space's cell (cells.ts). */
export type Landing =
  | { kind: 'strip'; paneId: string; before: string | null }
  | { kind: 'side'; paneId: string; side: Side }
  | { kind: 'space'; key: string }

/** How far past a pane's windows the pointer goes before it is against that side. */
const EDGE = 40

/** A pane's tabs with `id` moved to `landing`: what the canvas lays out while it is
 *  dragged. */
export function withMoved(
  tabsOf: (paneId: string) => readonly string[],
  id: string,
  landing: Landing | null,
): (paneId: string) => readonly string[] {
  if (!landing) return tabsOf
  return (paneId) => {
    const rest = tabsOf(paneId).filter((one) => one !== id)
    if (landing.kind === 'space') return rest
    if (landing.kind === 'side') return paneId === MADE ? [id] : rest
    if (paneId !== landing.paneId) return rest
    const at = landing.before === null ? -1 : rest.indexOf(landing.before)
    return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)]
  }
}

/** The pane a window against a side would make, as the canvas lays it out meanwhile. */
export const MADE = 'overview-made'

/** The frame the canvas lays out while a window is against a side: the pane split
 *  there, the new pane on that side. */
export function withLanding(frame: Frame, landing: Landing | null): Frame {
  if (landing?.kind !== 'side') return frame
  return withSplit(
    frame,
    landing.paneId,
    alongOf(landing.side),
    pane(MADE),
    `${MADE}-split`,
    madeFirst(landing.side),
  )
}

/** Which side of `windows` the point is past by more than `EDGE`, the furthest. */
/** How far outside every pane's room the pointer may be and still be against one: the
 *  margin between the canvas and the edge of the screen. */
const REACH = 240

/** The room the point is in, or the nearest within `REACH`. */
function roomNear(rooms: readonly Room[], x: number, y: number): Room | null {
  let best: Room | null = null
  let bestFar = REACH
  for (const room of rooms) {
    const dx = Math.max(room.x - x, 0, x - (room.x + room.w))
    const dy = Math.max(room.y - y, 0, y - (room.y + room.h))
    const far = Math.hypot(dx, dy)
    if (far <= bestFar) {
      best = room
      bestFar = far
    }
  }
  return best
}

function sideOf(windows: readonly Slot[], x: number, y: number): Side | null {
  const box = around(windows)
  if (!box) return null
  const past: [Side, number][] = [
    ['left', box.x - x],
    ['right', x - (box.x + box.w)],
    ['top', box.y - y],
    ['bottom', y - (box.y + box.h)],
  ]
  const [side, far] = past.reduce((best, one) => (one[1] > best[1] ? one : best))
  return far > EDGE ? side : null
}

/** Where a window dropped at `x`, `y` lands, on the canvas without it: against a side
 *  of the pane whose room it is in or nearest, past that pane's windows - where `splits` says a
 *  pane may go - or else in a strip. Null where there is nothing to land by. */
export function landingAt(
  slots: readonly Slot[],
  rooms: readonly Room[],
  x: number,
  y: number,
  splits: (paneId: string, side: Side) => boolean = () => true,
): Landing | null {
  const room = roomNear(rooms, x, y)
  if (room) {
    const side = sideOf(
      slots.filter((one) => one.paneId === room.paneId),
      x,
      y,
    )
    if (side && splits(room.paneId, side)) return { kind: 'side', paneId: room.paneId, side }
  }
  return inStrip(slots, x, y)
}

function inStrip(slots: readonly Slot[], x: number, y: number): Landing | null {
  let nearest: Slot | null = null
  let best = Number.POSITIVE_INFINITY
  for (const slot of slots) {
    // How far the point is from the slot's box: nothing at all inside it.
    const dx = Math.max(slot.x - x, 0, x - (slot.x + slot.w))
    const dy = Math.max(slot.y - y, 0, y - (slot.y + slot.h))
    const far = Math.hypot(dx, dy)
    if (far < best) {
      best = far
      nearest = slot
    }
  }
  if (!nearest) return null

  const after = x > nearest.x + nearest.w / 2
  if (!after) return { kind: 'strip', paneId: nearest.paneId, before: nearest.id }
  const ofPane = slots.filter((one) => one.paneId === nearest.paneId)
  const next = ofPane[ofPane.indexOf(nearest) + 1]
  return { kind: 'strip', paneId: nearest.paneId, before: next?.id ?? null }
}

/** Whether the pointer has gone far enough from where it was pressed to be a drag
 *  rather than a press. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 5
}
