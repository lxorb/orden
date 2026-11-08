import type { Canvas, CanvasEdge, CanvasNode, Shape, Side } from './format'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  width: number
  height: number
}

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

export const GRID = 20

export function snapped(value: number): number {
  return Math.round(value / GRID) * GRID
}

export function boxOf(node: CanvasNode): Box {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

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

export function edgeEnds(edge: CanvasEdge, from: Box, to: Box): EdgeEnds {
  const fromSide = edge.fromSide ?? facingSide(from, to)
  const toSide = edge.toSide ?? facingSide(to, from)

  return { from: sidePoint(from, fromSide), to: sidePoint(to, toSide), fromSide, toSide }
}

const LEAN = 0.4
const LEAST_LEAN = 24

export function edgeCurve(ends: EdgeEnds): [Point, Point, Point, Point] {
  const { from, to } = ends
  const away = Math.hypot(to.x - from.x, to.y - from.y)
  const lean = Math.max(LEAST_LEAN, away * LEAN)

  const out = outward(ends.fromSide)
  const back = outward(ends.toSide)

  return [
    from,
    { x: from.x + out.x * lean, y: from.y + out.y * lean },
    { x: to.x + back.x * lean, y: to.y + back.y * lean },
    to,
  ]
}

export function edgePath(ends: EdgeEnds): string {
  const [from, first, second, to] = edgeCurve(ends)

  return `M ${round(from.x)} ${round(from.y)} C ${round(first.x)} ${round(first.y)}, ${round(second.x)} ${round(second.y)}, ${round(to.x)} ${round(to.y)}`
}

function round(value: number): number {
  return Math.round(value * 2) / 2
}

export function arrowAt(point: Point, side: Side): { x: number; y: number; angle: number } {
  const facing = outward(side)
  return { x: point.x, y: point.y, angle: (Math.atan2(-facing.y, -facing.x) * 180) / Math.PI }
}

export function edgeMiddle(ends: EdgeEnds): Point {
  const [from, first, second, to] = edgeCurve(ends)

  return {
    x: (from.x + 3 * first.x + 3 * second.x + to.x) / 8,
    y: (from.y + 3 * first.y + 3 * second.y + to.y) / 8,
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

export function nodeAt(nodes: readonly CanvasNode[], point: Point, edge = 12): CanvasNode | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (!node) continue

    const box = boxOf(node)
    if (!within(grown(box, edge / 2), point)) continue
    if (node.type === 'group' && within(inset(box, edge), point)) continue

    if (node.type === 'shape') {
      if (!within(box, point) && !isLineShape(node.shape)) continue
      if (!onShape(node, point, edge / 2)) continue
    }

    return node
  }

  return null
}

export type LineShape = 'line' | 'arrow' | 'elbow'

export function isLineShape(shape: Shape): shape is LineShape {
  return shape === 'line' || shape === 'arrow' || shape === 'elbow'
}

function onShape(node: CanvasNode & { type: 'shape' }, point: Point, reach: number): boolean {
  const box = boxOf(node)

  if (isLineShape(node.shape)) {
    return alongPath(shapePath(node), point) <= reach
  }

  switch (node.shape) {
    case 'rect':
      return node.fill ? within(box, point) : !within(inset(box, reach), point)
    case 'rhombus':
    case 'triangle': {
      const corners = shapePath(node)
      if (node.fill || node.text) return insidePolygon(corners, point)
      return alongPath([...corners, corners[0] ?? point], point) <= reach
    }
    case 'ellipse': {
      const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const rx = Math.max(0.5, box.width / 2)
      const ry = Math.max(0.5, box.height / 2)
      const away = ((point.x - middle.x) / rx) ** 2 + ((point.y - middle.y) / ry) ** 2
      if (node.fill || node.text) return away <= 1

      const slack = reach / Math.min(rx, ry)
      return away <= (1 + slack) ** 2 && away >= Math.max(0, 1 - slack) ** 2
    }
  }
}

export function shapePath(node: CanvasNode & { type: 'shape' }): Point[] {
  const left = node.x
  const right = node.x + node.width
  const top = node.y
  const bottom = node.y + node.height
  const middleX = left + node.width / 2

  switch (node.shape) {
    case 'rhombus':
      return [
        { x: middleX, y: top },
        { x: right, y: top + node.height / 2 },
        { x: middleX, y: bottom },
        { x: left, y: top + node.height / 2 },
      ]
    case 'triangle':
      return [
        { x: middleX, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]
    case 'elbow': {
      const line = shapeLine(node)
      return [line.from, { x: line.to.x, y: line.from.y }, line.to]
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse': {
      const line = shapeLine(node)
      return [line.from, line.to]
    }
  }
}

function alongPath(points: readonly (Point | undefined)[], point: Point): number {
  let least = Infinity

  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if (!from || !to) continue

    least = Math.min(least, awayFromSegment(point, from, to))
  }

  return least
}

export function insidePolygon(corners: readonly Point[], point: Point): boolean {
  let inside = false

  for (let one = 0, other = corners.length - 1; one < corners.length; other = one++) {
    const here = corners[one]
    const there = corners[other]
    if (!here || !there) continue

    const crosses =
      here.y > point.y !== there.y > point.y &&
      point.x < ((there.x - here.x) * (point.y - here.y)) / (there.y - here.y) + here.x

    if (crosses) inside = !inside
  }

  return inside
}

export function awayFromSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  const along = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length),
  )
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy))
}

function grown(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by }
}

function inset(box: Box, by: number): Box {
  return {
    x: box.x + by,
    y: box.y + by,
    width: Math.max(0, box.width - 2 * by),
    height: Math.max(0, box.height - 2 * by),
  }
}

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

export function caught(nodes: readonly CanvasNode[], band: Box): string[] {
  return nodes.filter((node) => overlaps(boxOf(node), band)).map((node) => node.id)
}

export function bounds(boxes: readonly Box[]): Box | null {
  const [first] = boxes
  if (!first) return null

  let least = first.x
  let most = first.x + first.width
  let lowest = first.y
  let highest = first.y + first.height

  for (const box of boxes) {
    least = Math.min(least, box.x)
    most = Math.max(most, box.x + box.width)
    lowest = Math.min(lowest, box.y)
    highest = Math.max(highest, box.y + box.height)
  }

  return { x: least, y: lowest, width: most - least, height: highest - lowest }
}

export function insideGroup(group: Box, node: Box): boolean {
  return (
    node.x >= group.x &&
    node.y >= group.y &&
    node.x + node.width <= group.x + group.width &&
    node.y + node.height <= group.y + group.height
  )
}

export function containing<T>(items: readonly T[], box: (one: T) => Box): (group: Box) => T[] {
  const boxes = items.map(box)
  const order = boxes.map((_, at) => at).sort((a, b) => (boxes[a]?.x ?? 0) - (boxes[b]?.x ?? 0))
  const lefts = order.map((at) => boxes[at]?.x ?? 0)

  return (group) => {
    let low = 0
    let high = lefts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((lefts[middle] ?? 0) < group.x) low = middle + 1
      else high = middle
    }

    const out: T[] = []
    for (let at = low; at < order.length && (lefts[at] ?? 0) <= group.x + group.width; at++) {
      const one = order[at] ?? 0
      const held = boxes[one]
      const item = items[one]
      if (held && item !== undefined && insideGroup(group, held)) out.push(item)
    }
    return out
  }
}

export function gathered(
  groups: readonly CanvasNode[],
  moving: Set<string>,
  inside: () => (group: Box) => CanvasNode[],
): CanvasNode[] {
  const waiting = groups.slice()
  const reached: CanvasNode[] = []

  for (let group = waiting.pop(); group; group = waiting.pop()) {
    reached.push(group)
    for (const node of inside()(boxOf(group))) {
      if (moving.has(node.id)) continue
      moving.add(node.id)
      if (node.type === 'group') waiting.push(node)
    }
  }

  return reached
}

export function dragged(canvas: Canvas, picked: readonly string[]): string[] {
  const moving = new Set(picked)
  const groups = canvas.nodes.filter((node) => node.type === 'group' && moving.has(node.id))
  let inside: ((group: Box) => CanvasNode[]) | null = null
  gathered(
    groups,
    moving,
    () =>
      (inside ??= containing(
        canvas.nodes.filter((node) => !node.locked),
        boxOf,
      )),
  )

  return [...moving]
}

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

export function resizedBox(box: Box, handle: HandleId, dx: number, dy: number, least: number): Box {
  const pull = HANDLES.find((one) => one.id === handle)
  if (!pull) return box

  let { x, y, width, height } = box

  if (pull.x < 0) {
    const right = x + width
    x = Math.min(Math.round(x + dx), right - least)
    width = right - x
  } else if (pull.x > 0) {
    width = Math.max(least, Math.round(width + dx))
  }

  if (pull.y < 0) {
    const bottom = y + height
    y = Math.min(Math.round(y + dy), bottom - least)
    height = bottom - y
  } else if (pull.y > 0) {
    height = Math.max(least, Math.round(height + dy))
  }

  return { x, y, width, height }
}

export function keptAspect(was: Box, now: Box, handle: HandleId, least: number): Box {
  if (was.width < 1 || was.height < 1) return now

  const ratio = was.width / was.height
  const acrossLed =
    handle === 'e' || handle === 'w'
      ? true
      : handle === 'n' || handle === 's'
        ? false
        : Math.abs(now.width - was.width) / was.width >=
          Math.abs(now.height - was.height) / was.height

  const width = acrossLed ? now.width : Math.max(least, Math.round(now.height * ratio))
  const height = acrossLed ? Math.max(least, Math.round(now.width / ratio)) : now.height

  const pull = HANDLES.find((one) => one.id === handle)
  const x = pull && pull.x < 0 ? now.x + now.width - width : now.x
  const y = pull && pull.y < 0 ? now.y + now.height - height : now.y

  return {
    x: Math.round(pull?.x === 0 ? was.x + was.width / 2 - width / 2 : x),
    y: Math.round(pull?.y === 0 ? was.y + was.height / 2 - height / 2 : y),
    width,
    height,
  }
}

export function shapeLine(node: CanvasNode & { type: 'shape' }): { from: Point; to: Point } {
  const left = node.x
  const right = node.x + node.width
  const top = node.y
  const bottom = node.y + node.height

  return node.up
    ? { from: { x: left, y: bottom }, to: { x: right, y: top } }
    : { from: { x: left, y: top }, to: { x: right, y: bottom } }
}
