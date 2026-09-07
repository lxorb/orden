/** The arithmetic of the plane: where a node sits, where an edge meets it, what
 *  a pointer is over, and what a rubber band caught.
 *
 *  Pure, and in one place, because the drawing and the pointer both read it: a
 *  click that lands somewhere other than where the node was drawn is the one bug
 *  a surface like this cannot afford. Everything here is in plane coordinates,
 *  which are the ones the file is written in; the camera is next door. */

import type { Canvas, CanvasEdge, CanvasNode, Side } from './format'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  width: number
  height: number
}

/** How far apart the dots are, and what a dragged node lands on. Obsidian's own
 *  step, so a canvas edited in either app stays on one grid. */
export const GRID = 20

/** A value on the grid. */
export function snapped(value: number): number {
  return Math.round(value / GRID) * GRID
}

export function boxOf(node: CanvasNode): Box {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The middle of one side of a box, which is where an edge meets it. */
export function sidePoint(box: Box, side: Side): Point {
  const middle = centreOf(box)

  switch (side) {
    case 'top':
      return { x: middle.x, y: box.y }
    case 'right':
      return { x: box.x + box.width, y: middle.y }
    case 'bottom':
      return { x: middle.x, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: middle.y }
  }
}

/** Which way a side faces, as a unit vector. What bends a curve outwards from
 *  the node rather than straight at the other one. */
function outward(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'right':
      return { x: 1, y: 0 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
  }
}

/** The side of `from` that faces `to`. What an edge uses when the file names no
 *  side: whichever way the two boxes are further apart, since that is the side a
 *  person would have drawn from.
 *
 *  Compared as a share of each box's own size rather than in pixels, so a wide
 *  card beside a tall one still connects the way it looks like it should. */
export function facingSide(from: Box, to: Box): Side {
  const here = centreOf(from)
  const there = centreOf(to)
  const across = there.x - here.x
  const down = there.y - here.y

  if (Math.abs(across) * from.height >= Math.abs(down) * from.width) {
    return across >= 0 ? 'right' : 'left'
  }

  return down >= 0 ? 'bottom' : 'top'
}

export interface EdgeEnds {
  from: Point
  to: Point
  fromSide: Side
  toSide: Side
}

/** Where an edge starts and ends. A side the file names is used as written; one
 *  it leaves out is worked out from where the two boxes are, which is what makes
 *  an edge follow its nodes when they are dragged apart. */
export function edgeEnds(edge: CanvasEdge, from: Box, to: Box): EdgeEnds {
  const fromSide = edge.fromSide ?? facingSide(from, to)
  const toSide = edge.toSide ?? facingSide(to, from)

  return { from: sidePoint(from, fromSide), to: sidePoint(to, toSide), fromSide, toSide }
}

/** How far a curve leans out of a node before it turns towards the other one.
 *  A share of the distance, so a short edge is a gentle bend and a long one a
 *  proper curve, with a floor so two nodes almost touching still leave their
 *  sides at a right angle. */
const LEAN = 0.4
const LEAST_LEAN = 24

/** The edge as an SVG path: a cubic that leaves each node at a right angle to
 *  the side it meets, which is how a drawn connector reads whichever way the
 *  nodes are arranged. */
export function edgePath(ends: EdgeEnds): string {
  const { from, to } = ends
  const away = Math.hypot(to.x - from.x, to.y - from.y)
  const lean = Math.max(LEAST_LEAN, away * LEAN)

  const out = outward(ends.fromSide)
  const back = outward(ends.toSide)
  const first = { x: from.x + out.x * lean, y: from.y + out.y * lean }
  const second = { x: to.x + back.x * lean, y: to.y + back.y * lean }

  return `M ${round(from.x)} ${round(from.y)} C ${round(first.x)} ${round(first.y)}, ${round(second.x)} ${round(second.y)}, ${round(to.x)} ${round(to.y)}`
}

/** Half a pixel is as fine as a path needs to be, and a shorter string is less
 *  for the browser to parse on every frame of a drag. */
function round(value: number): number {
  return Math.round(value * 2) / 2
}

/** Where an arrow head sits and which way it points: at the end of the edge,
 *  facing into the node it meets. */
export function arrowAt(point: Point, side: Side): { x: number; y: number; angle: number } {
  const facing = outward(side)
  // Into the node, which is the opposite of the way the side faces.
  return { x: point.x, y: point.y, angle: (Math.atan2(-facing.y, -facing.x) * 180) / Math.PI }
}

/** Halfway along the edge, where a label goes. The midpoint of the cubic, which
 *  for these control points is a step out from each end towards the other. */
export function edgeMiddle(ends: EdgeEnds): Point {
  const { from, to } = ends
  const away = Math.hypot(to.x - from.x, to.y - from.y)
  const lean = Math.max(LEAST_LEAN, away * LEAN)
  const out = outward(ends.fromSide)
  const back = outward(ends.toSide)

  // The cubic at t = 0.5, which is where the four points average out with the
  // middle pair counting three times each.
  return {
    x: (from.x + 3 * (from.x + out.x * lean) + 3 * (to.x + back.x * lean) + to.x) / 8,
    y: (from.y + 3 * (from.y + out.y * lean) + 3 * (to.y + back.y * lean) + to.y) / 8,
  }
}

export function within(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

/** The node under a point, or null. The last one that holds it, because the
 *  nodes are drawn in order and the last is the one on top.
 *
 *  A group is only picked up by its own frame, never by the middle of it: a
 *  group is a label around some room, and clicking the room inside it means the
 *  room rather than the group. `edge` is how wide that frame is. */
export function nodeAt(nodes: readonly CanvasNode[], point: Point, edge = 12): CanvasNode | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (!node) continue

    const box = boxOf(node)
    if (!within(box, point)) continue
    if (node.type === 'group' && within(inset(box, edge), point)) continue

    return node
  }

  return null
}

/** The same box with `by` pixels taken off every side. Empty rather than
 *  inverted for a box too small to take it. */
function inset(box: Box, by: number): Box {
  return {
    x: box.x + by,
    y: box.y + by,
    width: Math.max(0, box.width - 2 * by),
    height: Math.max(0, box.height - 2 * by),
  }
}

/** The rectangle two points make, whichever corner the drag started in. */
export function rectBetween(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

export function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

/** Everything a rubber band caught: a node it touches at all, the way a file
 *  manager's own band works. */
export function caught(nodes: readonly CanvasNode[], band: Box): string[] {
  return nodes.filter((node) => overlaps(boxOf(node), band)).map((node) => node.id)
}

/** The box around every node, or null for an empty canvas. What Ctrl+0 frames. */
export function bounds(nodes: readonly CanvasNode[]): Box | null {
  const [first] = nodes
  if (!first) return null

  let least = first.x
  let most = first.x + first.width
  let lowest = first.y
  let highest = first.y + first.height

  for (const node of nodes) {
    least = Math.min(least, node.x)
    most = Math.max(most, node.x + node.width)
    lowest = Math.min(lowest, node.y)
    highest = Math.max(highest, node.y + node.height)
  }

  return { x: least, y: lowest, width: most - least, height: highest - lowest }
}

/** Whether a node sits inside a group, which is what makes a group carry it.
 *  Its whole box, not its middle: half a card hanging out of a frame belongs to
 *  whatever it is mostly in, and a person who wanted it carried would have put
 *  it inside. */
export function insideGroup(group: Box, node: Box): boolean {
  return (
    node.x >= group.x &&
    node.y >= group.y &&
    node.x + node.width <= group.x + group.width &&
    node.y + node.height <= group.y + group.height
  )
}

/** Everything a drag of these nodes takes with it: the nodes themselves, and
 *  whatever sits inside any group among them. A group inside a group carries its
 *  own contents too, so the walk repeats until nothing new is caught. */
export function dragged(canvas: Canvas, picked: readonly string[]): string[] {
  const moving = new Set(picked)
  const groups = canvas.nodes.filter((node) => node.type === 'group')
  if (!groups.length) return [...moving]

  for (;;) {
    const before = moving.size

    for (const group of groups) {
      if (!moving.has(group.id)) continue

      for (const node of canvas.nodes) {
        if (node.id === group.id || moving.has(node.id)) continue
        if (insideGroup(boxOf(group), boxOf(node))) moving.add(node.id)
      }
    }

    if (moving.size === before) return [...moving]
  }
}

/** The eight handles a selected node is resized by, and which way each pulls. */
export const HANDLES = [
  { id: 'nw', x: -1, y: -1 },
  { id: 'n', x: 0, y: -1 },
  { id: 'ne', x: 1, y: -1 },
  { id: 'e', x: 1, y: 0 },
  { id: 'se', x: 1, y: 1 },
  { id: 's', x: 0, y: 1 },
  { id: 'sw', x: -1, y: 1 },
  { id: 'w', x: -1, y: 0 },
] as const

export type HandleId = (typeof HANDLES)[number]['id']

/** How small a node may be dragged, in grid steps: small enough to be a marker
 *  beside something, big enough to still be grabbed. */
const LEAST = GRID * 2

/** A box after a handle has been dragged by `dx`, `dy`. The edges the handle
 *  pulls move and the others stay, and a side dragged past its opposite stops
 *  rather than turning the box inside out. */
export function resized(box: Box, handle: HandleId, dx: number, dy: number): Box {
  const pull = HANDLES.find((one) => one.id === handle)
  if (!pull) return box

  let { x, y, width, height } = box

  if (pull.x < 0) {
    const right = x + width
    x = Math.min(snapped(x + dx), right - LEAST)
    width = right - x
  } else if (pull.x > 0) {
    width = Math.max(LEAST, snapped(width + dx))
  }

  if (pull.y < 0) {
    const bottom = y + height
    y = Math.min(snapped(y + dy), bottom - LEAST)
    height = bottom - y
  } else if (pull.y > 0) {
    height = Math.max(LEAST, snapped(height + dy))
  }

  return { x, y, width, height }
}
