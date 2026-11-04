/** Windows placed freely on the overview's canvas (issue #331).
 *
 *  Emil, 2026-11-04: a window is not tied to a grid. It stays exactly where it is left,
 *  the others are pushed out of its way so that nothing lies on anything, and the one
 *  let go keeps its place. So the canvas is a set of boxes, some of them held still -
 *  the one under the hand, the ones somebody put somewhere - and the rest moved the
 *  least they can be until no two overlap (`settled`). Where a window let go lands in
 *  its pane's strip is read off where it lies among that pane's windows, in the order a
 *  page is read (`stripLanding`). Pure. */

import type { Box, Slot } from './layout'

/** The room kept between two windows side by side, and between one and the window
 *  under it, which holds the name under the upper one. */
const APART_X = 28
const APART_Y = 60

/** How often every pair is looked at before what is left is left: enough for a push to
 *  run down a row of a dozen windows. */
const ROUNDS = 200

/** How far `b` must move, at least, to be clear of `a`: along whichever axis is the
 *  shorter way out, away from `a`; null where they are already clear. */
function clearOf(a: Box, b: Box): { x: number; y: number } | null {
  const right = a.x + a.w + APART_X - b.x
  const left = b.x + b.w + APART_X - a.x
  const down = a.y + a.h + APART_Y - b.y
  const up = b.y + b.h + APART_Y - a.y
  // A hair is not an overlap: what a push leaves of one is rounding, not a window.
  if (Math.min(right, left, down, up) <= 0.5) return null
  const ax = a.x + a.w / 2
  const bx = b.x + b.w / 2
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  const x = bx >= ax ? right : -left
  const y = by >= ay ? down : -up
  // Out sideways, or out up or down, whichever is less of a move; level ones go aside.
  return Math.abs(x) * (APART_Y / APART_X) <= Math.abs(y) ? { x, y: 0 } : { x: 0, y }
}

/** The windows with none on another: each one in `still` where it is, the others moved
 *  the least they can be, a pair of movable ones each half the way. */
export function settled<T extends Box & { id: string }>(
  windows: readonly T[],
  still: ReadonlySet<string>,
): T[] {
  const out = windows.map((one) => ({ ...one }))
  for (let round = 0; round < ROUNDS; round++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        if (!a || !b) continue
        const away = clearOf(a, b)
        if (!away) continue
        const holdA = still.has(a.id)
        const holdB = still.has(b.id)
        if (holdA && holdB) continue
        const shareB = holdA ? 1 : holdB ? 0 : 0.5
        b.x += away.x * shareB
        b.y += away.y * shareB
        a.x -= away.x * (1 - shareB)
        a.y -= away.y * (1 - shareB)
        moved = true
      }
    }
    if (!moved) break
  }
  return out
}

/** Whether `a` comes before `b` in the order a page is read: the higher row first, and
 *  along a row from the left. Two windows whose middles are within half the lower one's
 *  height of each other are on one row. */
function readsBefore(a: Box, b: Box): number {
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  if (Math.abs(ay - by) < Math.min(a.h, b.h) / 2) return a.x + a.w / 2 - (b.x + b.w / 2)
  return ay - by
}

/** Where window `id`, let go at `box`, lands in a strip: the pane of the window nearest
 *  it, before the first of that pane's windows that it reads before. Null with no other
 *  window to land by. */
export function stripLanding(
  slots: readonly Slot[],
  id: string,
  box: Box,
): { paneId: string; before: string | null } | null {
  const others = slots.filter((one) => one.id !== id)
  let nearest: Slot | null = null
  let best = Number.POSITIVE_INFINITY
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  for (const one of others) {
    const dx = Math.max(one.x - cx, 0, cx - (one.x + one.w))
    const dy = Math.max(one.y - cy, 0, cy - (one.y + one.h))
    const far = Math.hypot(dx, dy)
    if (far < best) {
      best = far
      nearest = one
    }
  }
  if (!nearest) return null
  const paneId = nearest.paneId
  const ofPane = others.filter((one) => one.paneId === paneId).sort(readsBefore)
  const after = ofPane.find((one) => readsBefore(box, one) < 0)
  return { paneId, before: after?.id ?? null }
}

/** Whether two boxes lie on each other, counting the room kept between windows. */
export function overlaps(a: Box, b: Box): boolean {
  return clearOf(a, b) !== null
}
