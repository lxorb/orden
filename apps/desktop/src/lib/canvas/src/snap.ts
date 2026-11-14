import { type Box, GRID, type HandleId, snapped } from '../../plane/src/api'

interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

export interface Snap {
  dx: number
  dy: number
  guides: Guide[]
}

export const NO_SNAP: Snap = { dx: 0, dy: 0, guides: [] }

const REACH = GRID / 2

interface Span {
  from: number
  size: number
}

function acrossOf(box: Box): Span {
  return { from: box.x, size: box.width }
}

function downOf(box: Box): Span {
  return { from: box.y, size: box.height }
}

function stops(span: Span): [number, number, number] {
  return [span.from, span.from + span.size / 2, span.from + span.size]
}

function alignment(
  moving: Box,
  others: readonly Box[],
  reach: number,
  axis: 'x' | 'y',
): { offset: number; guide: Guide } | null {
  const pin = axis === 'x' ? acrossOf : downOf
  const run = axis === 'x' ? downOf : acrossOf

  const mine = stops(pin(moving))
  const along = run(moving)
  let best: { offset: number; guide: Guide } | null = null

  for (const other of others) {
    const theirs = stops(pin(other))
    const beside = run(other)

    for (const one of mine) {
      for (const two of theirs) {
        const offset = two - one
        if (Math.abs(offset) > reach) continue
        if (best && Math.abs(offset) >= Math.abs(best.offset)) continue

        best = {
          offset,
          guide: {
            axis,
            at: two,
            from: Math.min(along.from, beside.from),
            to: Math.max(along.from + along.size, beside.from + beside.size),
          },
        }
      }
    }
  }

  return best
}

export function snapMove(moving: Box, others: readonly Box[], reach = REACH): Snap {
  const across = alignment(moving, others, reach, 'x')
  const down = alignment(moving, others, reach, 'y')

  const guides: Guide[] = []
  if (across) guides.push(across.guide)
  if (down) guides.push(down.guide)

  return {
    dx: across ? across.offset : snapped(moving.x) - moving.x,
    dy: down ? down.offset : snapped(moving.y) - moving.y,
    guides,
  }
}

export function snapPoint(
  at: { x: number; y: number },
  others: readonly Box[],
  reach = REACH,
): Snap {
  const guides: Guide[] = []

  const across = nearestOf(at.x, at.y, others, reach, acrossOf, downOf)
  const down = nearestOf(at.y, at.x, others, reach, downOf, acrossOf)

  if (across) guides.push({ axis: 'x', at: across.at, from: across.from, to: across.to })
  if (down) guides.push({ axis: 'y', at: down.at, from: down.from, to: down.to })

  return {
    dx: (across?.at ?? snapped(at.x)) - at.x,
    dy: (down?.at ?? snapped(at.y)) - at.y,
    guides,
  }
}

function nearestOf(
  along: number,
  beside: number,
  others: readonly Box[],
  reach: number,
  pin: (box: Box) => Span,
  run: (box: Box) => Span,
): { at: number; from: number; to: number } | null {
  let best: { at: number; from: number; to: number } | null = null
  let nearby = reach

  for (const box of others) {
    const other = run(box)

    for (const place of stops(pin(box))) {
      const away = Math.abs(place - along)
      if (away > nearby) continue

      nearby = away
      best = {
        at: place,
        from: Math.min(beside, other.from),
        to: Math.max(beside, other.from + other.size),
      }
    }
  }

  return best
}

export function snapResize(
  box: Box,
  handle: HandleId,
  others: readonly Box[],
  reach = REACH,
): Snap {
  const edgeX = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : null
  const edgeY = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : null

  const guides: Guide[] = []
  let dx = 0
  let dy = 0

  if (edgeX !== null) {
    const found = nearestStop(edgeX, others, reach, acrossOf)
    dx = (found ?? snapped(edgeX)) - edgeX
    if (found !== null) guides.push({ axis: 'x', at: found, from: box.y, to: box.y + box.height })
  }

  if (edgeY !== null) {
    const found = nearestStop(edgeY, others, reach, downOf)
    dy = (found ?? snapped(edgeY)) - edgeY
    if (found !== null) guides.push({ axis: 'y', at: found, from: box.x, to: box.x + box.width })
  }

  return { dx, dy, guides }
}

function nearestStop(
  at: number,
  others: readonly Box[],
  reach: number,
  axis: (box: Box) => Span,
): number | null {
  let best: number | null = null
  let nearby = reach

  for (const box of others) {
    for (const place of stops(axis(box))) {
      const away = Math.abs(place - at)
      if (away > nearby) continue

      nearby = away
      best = place
    }
  }

  return best
}
