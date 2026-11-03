/** A window dragged on the overview's canvas, and where it would land (issue #331).
 *
 *  Where it lands is read off the canvas as it would be without it: the window under
 *  the pointer, or the nearest, and which half of it the pointer is over. That canvas
 *  does not move while the hand does, so the answer does not flicker between two places
 *  as the others make room. The others are then laid out with the dragged one already
 *  in its new place, which is how they make room. Pure. */

import type { Slot } from './layout'

/** Where a dragged tab would go: into a pane, before a tab of it, or at its end. */
export interface Landing {
  paneId: string
  before: string | null
}

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
    if (paneId !== landing.paneId) return rest
    const at = landing.before === null ? -1 : rest.indexOf(landing.before)
    return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)]
  }
}

/** Where a window dropped at `x`, `y` lands, among the slots of the canvas without it.
 *  Null where there is nothing else to land by. */
export function landingAt(slots: readonly Slot[], x: number, y: number): Landing | null {
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
  if (!after) return { paneId: nearest.paneId, before: nearest.id }
  const ofPane = slots.filter((one) => one.paneId === nearest.paneId)
  const next = ofPane[ofPane.indexOf(nearest) + 1]
  return { paneId: nearest.paneId, before: next?.id ?? null }
}

/** Whether the pointer has gone far enough from where it was pressed to be a drag
 *  rather than a press. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 5
}
