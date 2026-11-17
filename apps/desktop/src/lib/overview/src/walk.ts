import type { Box } from './layout'

export type Way = 'left' | 'right' | 'up' | 'down'

const WAYS: Record<string, Way> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

export function wayOf(key: string): Way | null {
  return WAYS[key] ?? null
}

const middle = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

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
