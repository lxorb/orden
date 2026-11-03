/** Which window an arrow goes to in the overview (issue #331).
 *
 *  The windows lie where the panes are, not in one grid, so Down from the last window of
 *  the left pane may be nothing in its own column and the top of the right one. The arrow
 *  goes to the nearest window whose middle lies that way, distance across the arrow
 *  counting double, the way a TV remote walks a page of tiles. Pure. */

import type { Box } from './layout'

export type Way = 'left' | 'right' | 'up' | 'down'

const WAYS: Record<string, Way> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** The way an arrow key points, or null for any other key. */
export function wayOf(key: string): Way | null {
  return WAYS[key] ?? null
}

const middle = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

/** The index of the window `way` of `boxes[from]`, or `from` where there is none. */
export function walk(boxes: readonly Box[], from: number, way: Way): number {
  const here = boxes[from]
  if (!here) return boxes.length ? 0 : -1

  const start = middle(here)
  let best = from
  let bestCost = Number.POSITIVE_INFINITY

  boxes.forEach((box, index) => {
    if (index === from) return
    const there = middle(box)
    const dx = there.x - start.x
    const dy = there.y - start.y
    const along = way === 'left' ? -dx : way === 'right' ? dx : way === 'up' ? -dy : dy
    const across = way === 'left' || way === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) return

    const cost = along + across * 2
    if (cost < bestCost) {
      bestCost = cost
      best = index
    }
  })

  return best
}
