import type { Canvas, CanvasNode, InkStroke, Side } from '@orden/markdown/canvas'
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
  nearStroke,
} from '../../plane/src/api'
import { FORGIVING, type Hit, NOTHING } from './pointer'

export const HANDLE = 9
export const PORT = 9
const PORT_REACH = 12
const PORT_INSIDE = 4
const ROOM = 3
export const roomFor = (box: Box, scale: number, size: number): boolean =>
  Math.min(box.width, box.height) * scale >= ROOM * size
export interface Where {
  canvas: Canvas
  picked: readonly string[]
  box: Box | null
  scale: number
  ported: string | null
  ports: boolean
  coarse: boolean
  lassoed: boolean
}
export function hitAt(where: Where, point: Point): Hit {
  const unit = 1 / where.scale
  const slack = (where.coarse ? FORGIVING : 0) * unit
  const handle = handleAt(where, point, slack)
  if (handle) return where.lassoed ? { ...NOTHING, ink: handle } : { ...NOTHING, handle }
  if (where.lassoed && where.box && turnAt(where.box, point, HANDLE * 2.4 * unit + slack)) {
    return { ...NOTHING, ink: 'turn' }
  }
  const endpoint = endpointAt(where, point, HANDLE / 2 / where.scale + slack)
  if (endpoint) return { ...NOTHING, endpoint }
  const free = where.canvas.nodes.filter((one) => !one.locked)
  const edgeReach = 6 * unit + slack
  const port = where.ports ? portAt(where, free, point, slack) : null
  const dot = PORT / 2 / where.scale + 2 * unit + slack
  if (port && (port.away <= dot || !edgeAt(where.canvas, point, edgeReach, port.id))) {
    return { ...NOTHING, port: { id: port.id, side: port.side } }
  }
  const node = nodeAt(free, point, 12)
  if (node) return { ...NOTHING, node: node.id }
  const edge = edgeAt(where.canvas, point, edgeReach)
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
  const wanted = new Set(where.picked)
  const picked = where.canvas.edges.filter((edge) => wanted.has(edge.id))
  if (!picked.length) return null
  const byId = new Map(where.canvas.nodes.map((node) => [node.id, node]))
  for (const edge of picked) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
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
interface Near {
  id: string
  side: Side
  away: number
}
function portAt(where: Where, free: readonly CanvasNode[], point: Point, slack: number): Near | null {
  const reach = PORT_REACH / where.scale + slack
  const inside = PORT_INSIDE / where.scale
  const top = nodeAt(free, point, 0)
  const nearest = (node: CanvasNode): Near | null => {
    const box = boxOf(node)
    if ((top && top.id !== node.id) || !roomFor(box, where.scale, PORT)) return null
    let best: Near | null = null
    for (const side of SIDES) {
      const at = sidePoint(box, side)
      const away = Math.hypot(point.x - at.x, point.y - at.y)
      if (away > reach || depth(box, side, point) > inside) continue
      if (!best || away < best.away) best = { id: node.id, side, away }
    }
    return best
  }
  const hovered = where.ported === null ? undefined : free.find((one) => one.id === where.ported)
  const near = hovered ? nearest(hovered) : null
  if (near || where.coarse) return near
  for (let index = free.length - 1; index >= 0; index--) {
    const node = free[index]
    const found = node && node !== hovered ? nearest(node) : null
    if (found) return found
  }
  return null
}
function depth(box: Box, side: Side, point: Point): number {
  switch (side) {
    case 'top':
      return point.y - box.y
    case 'right':
      return box.x + box.width - point.x
    case 'bottom':
      return box.y + box.height - point.y
    case 'left':
      return point.x - box.x
  }
}
const SAMPLES = 40
function edgeAt(canvas: Canvas, point: Point, reach: number, apart: string | null = null): string | null {
  if (!canvas.edges.length) return null
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  for (let index = canvas.edges.length - 1; index >= 0; index--) {
    const edge = canvas.edges[index]
    if (!edge || edge.fromNode === apart || edge.toNode === apart) continue
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
  return point.x >= least - reach && point.x <= most + reach && point.y >= lowest - reach && point.y <= highest + reach
}
function curvePoints(curve: readonly [Point, Point, Point, Point]): Point[] {
  const [first, second, third, last] = curve
  const out: Point[] = []
  for (let step = 0; step <= SAMPLES; step++) {
    const t = step / SAMPLES
    const u = 1 - t
    out.push({
      x: u * u * u * first.x + 3 * u * u * t * second.x + 3 * u * t * t * third.x + t * t * t * last.x,
      y: u * u * u * first.y + 3 * u * u * t * second.y + 3 * u * t * t * third.y + t * t * t * last.y,
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
