/** What a dragged box lands on, and the lines that say why.
 *
 *  Two things pull: the grid, which is where a card belongs when there is
 *  nothing to line it up with, and the other cards, whose edges and middles a
 *  card wants to share. A card wins over the grid, so lining one up with its
 *  neighbour is never undone by a grid step half a pixel closer.
 *
 *  The guides come back with the offset rather than being worked out again for
 *  the drawing, because a line the surface drew that the card did not obey is a
 *  surface telling a lie. */

import { type Box, GRID, type HandleId, snapped } from './geometry'

/** A line the surface draws while something is being lined up: which axis it
 *  pins, where on that axis it sits, and how far along the other one it runs. */
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

/** How far a snap reaches, in plane units at one to one. Half a grid step: near
 *  enough that lining up feels deliberate, far enough that it happens. */
const REACH = GRID / 2

/** One axis of a box: where it starts and how long it is. */
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

/** The three places a box lines up by on one axis: its two edges and its middle,
 *  which between them cover left-to-left, left-to-right, centred, and every
 *  other pairing a hand means. */
function stops(span: Span): [number, number, number] {
  return [span.from, span.from + span.size / 2, span.from + span.size]
}

/** How far a box has to move along one axis to line up with something, and the
 *  line that says so. Null when nothing is within reach.
 *
 *  `pin` is the axis being lined up and `run` is the other one, which is the way
 *  the guide runs: two cards sharing a left edge are told so by a vertical line
 *  down past both of them. */
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

/** Where a box being dragged should land, given everything else on the plane.
 *
 *  `others` is whatever the drag is not carrying: a card cannot line itself up
 *  with a card that is moving with it. */
export function snapMove(moving: Box, others: readonly Box[], reach = REACH): Snap {
  const across = alignment(moving, others, reach, 'x')
  const down = alignment(moving, others, reach, 'y')

  const guides: Guide[] = []
  if (across) guides.push(across.guide)
  if (down) guides.push(down.guide)

  return {
    // The grid catches whichever axis nothing else did, so a card in open space
    // still lands on it and a card beside a neighbour lines up with the
    // neighbour rather than with the dots.
    dx: across ? across.offset : snapped(moving.x) - moving.x,
    dy: down ? down.offset : snapped(moving.y) - moving.y,
    guides,
  }
}

/** Where one loose point should land: on the edge or the middle of something
 *  already on the plane, or on the grid.
 *
 *  What the corner of something being pulled out of the bar lands on. A point has
 *  no edges of its own to line up, so it is the point itself against everything
 *  else's three stops, which is what makes a box dragged out beside a card come out
 *  the same width as the card. */
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

/** The nearest stop on one axis, and how far the line saying so has to run to
 *  reach both the point and the box it lined up with. */
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

/** The same for a resize: only the edges the handle is pulling look for
 *  something to land on, since the others are not moving and lining them up
 *  again would drag the whole card sideways. */
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
