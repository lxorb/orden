/** The spaces' bubbles packed close round a middle nobody sees (issue #331).
 *
 *  Emil, round 4: Tidy up laid the bubbles out in one long row. They go round a middle
 *  instead, each in the free place nearest it, so they lie close together, none on
 *  another, the way coins pushed together on a table do. The first goes on the middle
 *  itself; every next one is tried against every side of every one placed, at every
 *  height or width that lines it up with something there, and takes the free place
 *  whose middle is nearest the middle of all. Lengths are on the canvas only: nothing
 *  here knows the zoom, so where a bubble lies never changes as the camera moves in or
 *  out. Pure. */

import type { Box } from './layout'

export interface Sized {
  key: string
  w: number
  h: number
}

/** Whether two boxes come nearer than `gap` to each other. */
export function meets(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap - 0.01 &&
    b.x < a.x + a.w + gap - 0.01 &&
    a.y < b.y + b.h + gap - 0.01 &&
    b.y < a.y + a.h + gap - 0.01
  )
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high))

/** Where each of `items` goes, by key: packed round `middle`, `gap` apart from each
 *  other and from every box of `taken`, which stay where they are. `wide` stretches how
 *  far counts as near across against down, so the pack takes the shape of a screen
 *  rather than of a coin. */
export function packed(
  items: readonly Sized[],
  gap: number,
  taken: readonly Box[] = [],
  middle: { x: number; y: number } = { x: 0, y: 0 },
  wide = 1,
): Record<string, Box> {
  const placed: Box[] = [...taken]
  const out: Record<string, Box> = {}
  const far = (box: Box) =>
    Math.hypot((box.x + box.w / 2 - middle.x) / wide, box.y + box.h / 2 - middle.y)
  for (const item of items) {
    const { w, h } = item
    const best: { box: Box | null; off: number } = { box: null, off: Number.POSITIVE_INFINITY }
    const tryAt = (x: number, y: number) => {
      const box = { x, y, w, h }
      const off = far(box)
      if (off >= best.off - 1e-6) return
      if (placed.some((one) => meets(one, box, gap))) return
      best.box = box
      best.off = off
    }
    tryAt(middle.x - w / 2, middle.y - h / 2)
    if (!best.box) {
      // What a new box can be lined up with: the middle, and every edge of every box.
      const xs = [middle.x - w / 2]
      const ys = [middle.y - h / 2]
      for (const one of placed) {
        xs.push(one.x, one.x + one.w - w, one.x + one.w + gap, one.x - w - gap)
        ys.push(one.y, one.y + one.h - h, one.y + one.h + gap, one.y - h - gap)
      }
      for (const one of placed) {
        // Beside it, right or left, at any height that still meets its side; and over or
        // under it, at any width that still meets its top or foot.
        for (const x of [one.x + one.w + gap, one.x - w - gap])
          for (const y of ys) tryAt(x, clamp(y, one.y - h + 1, one.y + one.h - 1))
        for (const y of [one.y + one.h + gap, one.y - h - gap])
          for (const x of xs) tryAt(clamp(x, one.x - w + 1, one.x + one.w - 1), y)
      }
    }
    const box: Box = best.box ?? { x: middle.x - w / 2, y: middle.y - h / 2, w, h }
    placed.push(box)
    out[item.key] = box
  }
  return out
}
