import { grownOf } from './bubble'
import type { Box } from './layout'

export interface Cell {
  key: string
  box: Box
}

export const REACH = 72
const HOLD = 24

function from(box: Box, x: number, y: number): number {
  const dx = Math.max(box.x - x, x - (box.x + box.w))
  const dy = Math.max(box.y - y, y - (box.y + box.h))
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
}

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
    const counted =
      far <= 0 ? (cell.key === now ? -Infinity : far - 1e9) : far - (cell.key === now ? hold : 0)
    if (counted < nearest) {
      best = cell.key
      nearest = counted
    }
  }
  return best
}
