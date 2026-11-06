import type { Canvas, InkStroke } from './format'
import {
  awayFromSegment,
  type Box,
  boxOf,
  edgeCurve,
  edgeEnds,
  HANDLES,
  type HandleId,
  nodeAt,
  type Point,
  SIDES,
  sidePoint,
  within,
} from './geometry'
import { nearStroke } from './ink'
import { FORGIVING, type Hit, NOTHING } from './pointer'

export const HANDLE = 9
export const PORT = 9

const ROOM = 3

export function roomFor(box: Box, scale: number, size: number): boolean {
  return Math.min(box.width, box.height) * scale >= ROOM * size
}

export interface Where {
  canvas: Canvas
  picked: readonly string[]
  box: Box | null
  scale: number
  ported: string | null
  coarse: boolean
  lassoed: boolean
}

export function hitAt(where: Where, point: Point): Hit {
  const unit = 1 / where.scale
  const slack = (where.coarse ? FORGIVING : 0) * unit

  const handle = handleAt(where, point, slack)
  if (handle) {
    return where.lassoed ? { ...NOTHING, ink: handle } : { ...NOTHING, handle }
  }

  if (where.lassoed && where.box && turnAt(where.box, point, HANDLE * 2.4 * unit + slack)) {
    return { ...NOTHING, ink: 'turn' }
  }

  const endpoint = endpointAt(where, point, HANDLE / 2 / where.scale + slack)
  if (endpoint) return { ...NOTHING, endpoint }

  const port = portAt(where, point, slack)
  if (port) return { ...NOTHING, port }

  const free = where.canvas.nodes.filter((one) => !one.locked)
  const node = nodeAt(free, point, 12)
  if (node) return { ...NOTHING, node: node.id }

  const edge = edgeAt(where.canvas, point, 6 * unit + slack)
  if (edge) return { ...NOTHING, edge }

  const stroke = strokeAt(where.canvas.ink, point, 2 * unit + slack)
  if (stroke) {
    if (where.lassoed && where.box && within(where.box, point)) {
      return { ...NOTHING, ink: 'inside', stroke }
    }
    return { ...NOTHING, stroke }
  }

  if (where.lassoed && where.box && within(where.box, point)) return { ...NOTHING, ink: 'inside' }

  return NOTHING
}

function handleAt(where: Where, point: Point, slack: number): HandleId | null {
  const box = where.box
  if (!box || !roomFor(box, where.scale, HANDLE)) return null

  const reach = HANDLE / 2 / where.scale + slack

  for (const handle of HANDLES) {
    const at = {
      x: box.x + ((handle.x + 1) / 2) * box.width,
      y: box.y + ((handle.y + 1) / 2) * box.height,
    }

    if (Math.abs(point.x - at.x) <= reach && Math.abs(point.y - at.y) <= reach) return handle.id
  }

  return null
}

function endpointAt(where: Where, point: Point, reach: number): Hit['endpoint'] {
  if (!where.picked.length) return null

  for (const edge of where.canvas.edges) {
    if (!where.picked.includes(edge.id)) continue

    const from = where.canvas.nodes.find((one) => one.id === edge.fromNode)
    const to = where.canvas.nodes.find((one) => one.id === edge.toNode)
    if (!from || !to) continue

    const ends = edgeEnds(edge, boxOf(from), boxOf(to))
    if (Math.hypot(point.x - ends.from.x, point.y - ends.from.y) <= reach) {
      return { id: edge.id, end: 'from' }
    }
    if (Math.hypot(point.x - ends.to.x, point.y - ends.to.y) <= reach) {
      return { id: edge.id, end: 'to' }
    }
  }

  return null
}

function turnAt(box: Box, point: Point, reach: number): boolean {
  const at = { x: box.x + box.width / 2, y: box.y - reach * 1.6 }
  return Math.hypot(point.x - at.x, point.y - at.y) <= reach
}

function portAt(where: Where, point: Point, slack: number): Hit['port'] {
  const id = where.ported
  if (!id) return null

  const node = where.canvas.nodes.find((one) => one.id === id)
  if (!node) return null

  const reach = PORT / 2 / where.scale + slack + 2 / where.scale
  const box = boxOf(node)

  for (const side of SIDES) {
    const at = sidePoint(box, side)
    if (Math.hypot(point.x - at.x, point.y - at.y) <= reach) return { id, side }
  }

  return null
}

const SAMPLES = 40

function edgeAt(canvas: Canvas, point: Point, reach: number): string | null {
  if (!canvas.edges.length) return null

  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))

  for (let index = canvas.edges.length - 1; index >= 0; index--) {
    const edge = canvas.edges[index]
    if (!edge) continue

    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue

    if (onCurve(edgeEnds(edge, boxOf(from), boxOf(to)), point, reach)) return edge.id
  }

  return null
}

function onCurve(ends: ReturnType<typeof edgeEnds>, point: Point, reach: number): boolean {
  const curve = edgeCurve(ends)

  if (!nearCurve(curve, point, reach)) return false

  const walked = curvePoints(curve)

  for (let one = 1; one < walked.length; one++) {
    const a = walked[one - 1]
    const b = walked[one]
    if (a && b && awayFromSegment(point, a, b) <= reach) return true
  }

  return false
}

function nearCurve(curve: readonly Point[], point: Point, reach: number): boolean {
  let least = Infinity
  let most = -Infinity
  let lowest = Infinity
  let highest = -Infinity

  for (const at of curve) {
    if (at.x < least) least = at.x
    if (at.x > most) most = at.x
    if (at.y < lowest) lowest = at.y
    if (at.y > highest) highest = at.y
  }

  return (
    point.x >= least - reach &&
    point.x <= most + reach &&
    point.y >= lowest - reach &&
    point.y <= highest + reach
  )
}

function curvePoints(curve: readonly [Point, Point, Point, Point]): Point[] {
  const [first, second, third, last] = curve
  const out: Point[] = []

  for (let step = 0; step <= SAMPLES; step++) {
    const t = step / SAMPLES
    const u = 1 - t
    out.push({
      x:
        u * u * u * first.x +
        3 * u * u * t * second.x +
        3 * u * t * t * third.x +
        t * t * t * last.x,
      y:
        u * u * u * first.y +
        3 * u * u * t * second.y +
        3 * u * t * t * third.y +
        t * t * t * last.y,
    })
  }

  return out
}

function strokeAt(ink: readonly InkStroke[], point: Point, reach: number): string | null {
  for (let index = ink.length - 1; index >= 0; index--) {
    const stroke = ink[index]
    if (stroke && nearStroke(stroke, point, reach)) return stroke.id
  }

  return null
}
