/** What is under a point.
 *
 *  One answer, worked out in one place, from the same arithmetic the drawing
 *  uses. The pointer machine is given this rather than going and asking, which
 *  is what keeps the machine pure; and because the drawing and the hit test read
 *  one geometry, a click cannot land somewhere other than where the thing is.
 *
 *  Order matters and is the order things are drawn in, back to front: the chrome
 *  a selection wears is on top of everything, then the cards, then the ink. A
 *  handle you can see is a handle you can grab. */

import type { Canvas, InkStroke } from './format'
import {
  awayFromSegment,
  type Box,
  boxOf,
  edgeEnds,
  edgePath,
  HANDLES,
  type HandleId,
  nodeAt,
  type Point,
  SIDES,
  sidePoint,
  within,
} from './geometry'
import { nearStroke } from './ink'
import { type Hit, NOTHING } from './pointer'

/** How big the chrome is on screen, in pixels, whatever the zoom. The handles
 *  and the dots are drawn at these sizes too, so what is grabbed is what is
 *  seen. */
export const HANDLE = 9
export const PORT = 9
/** How far a finger may miss a handle and still find it. A pen and a mouse are
 *  precise; a thumb is not, and the same numbers have to serve both. */
export const FORGIVING = 8

export interface Where {
  canvas: Canvas
  picked: readonly string[]
  /** The box the handles are drawn on, or null when nothing is picked. */
  box: Box | null
  /** Pixels per plane unit. */
  scale: number
  /** Whether the four connector dots are showing, and on what. */
  ported: string | null
  /** Whether the pointer is a finger, which needs more room to be wrong in. */
  coarse: boolean
  /** Whether the lasso's own handles are showing, which is when ink is picked. */
  lassoed: boolean
}

/** What the point is on. */
export function hitAt(where: Where, point: Point): Hit {
  const unit = 1 / where.scale
  const slack = (where.coarse ? FORGIVING : 0) * unit

  const handle = handleAt(where, point, slack)
  if (handle) {
    return where.lassoed ? { ...NOTHING, ink: handle } : { ...NOTHING, handle }
  }

  if (where.lassoed && where.box && turnAt(where.box, point, (HANDLE * 2.4) * unit + slack)) {
    return { ...NOTHING, ink: 'turn' }
  }

  const port = portAt(where, point, slack)
  if (port) return { ...NOTHING, port }

  const node = nodeAt(where.canvas.nodes, point, 12)
  if (node) return { ...NOTHING, node: node.id }

  const edge = edgeAt(where.canvas, point, 6 * unit + slack)
  if (edge) return { ...NOTHING, edge }

  const stroke = strokeAt(where.canvas.ink, point, 2 * unit + slack)
  if (stroke) {
    // Ink already picked and pressed inside its own box is a drag of the lot,
    // which is what a lasso is for.
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
  if (!box) return null

  const reach = (HANDLE / 2) / where.scale + slack

  for (const handle of HANDLES) {
    const at = {
      x: box.x + ((handle.x + 1) / 2) * box.width,
      y: box.y + ((handle.y + 1) / 2) * box.height,
    }

    if (Math.abs(point.x - at.x) <= reach && Math.abs(point.y - at.y) <= reach) return handle.id
  }

  return null
}

/** The ring above the box that turns what is picked. Above rather than at a
 *  corner, so it is never the same press as a resize. */
function turnAt(box: Box, point: Point, reach: number): boolean {
  const at = { x: box.x + box.width / 2, y: box.y - reach * 1.6 }
  return Math.hypot(point.x - at.x, point.y - at.y) <= reach
}

function portAt(where: Where, point: Point, slack: number): Hit['port'] {
  const id = where.ported
  if (!id) return null

  const node = where.canvas.nodes.find((one) => one.id === id)
  if (!node) return null

  const reach = (PORT / 2) / where.scale + slack + 2 / where.scale
  const box = boxOf(node)

  for (const side of SIDES) {
    const at = sidePoint(box, side)
    if (Math.hypot(point.x - at.x, point.y - at.y) <= reach) return { id, side }
  }

  return null
}

/** Which connector a point is on. Sampled along the curve rather than solved,
 *  because a cubic's distance has no closed form worth writing and forty points
 *  is finer than any hand aims. */
const SAMPLES = 40

function edgeAt(canvas: Canvas, point: Point, reach: number): string | null {
  for (let index = canvas.edges.length - 1; index >= 0; index--) {
    const edge = canvas.edges[index]
    if (!edge) continue

    const from = canvas.nodes.find((node) => node.id === edge.fromNode)
    const to = canvas.nodes.find((node) => node.id === edge.toNode)
    if (!from || !to) continue

    if (onCurve(edgeEnds(edge, boxOf(from), boxOf(to)), point, reach)) return edge.id
  }

  return null
}

function onCurve(
  ends: ReturnType<typeof edgeEnds>,
  point: Point,
  reach: number,
): boolean {
  const curve = curvePoints(ends)

  for (let one = 1; one < curve.length; one++) {
    const a = curve[one - 1]
    const b = curve[one]
    if (a && b && awayFromSegment(point, a, b) <= reach) return true
  }

  return false
}

/** The cubic the edge is drawn as, walked. Read off the same path string the
 *  drawing uses, so the two cannot disagree about where the line is. */
function curvePoints(ends: ReturnType<typeof edgeEnds>): Point[] {
  const numbers = edgePath(ends)
    .split(/[^\d.-]+/)
    .filter(Boolean)
    .map(Number)

  const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers
  if (
    x0 === undefined ||
    y0 === undefined ||
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined ||
    x3 === undefined ||
    y3 === undefined
  ) {
    return []
  }

  const out: Point[] = []
  for (let step = 0; step <= SAMPLES; step++) {
    const t = step / SAMPLES
    const u = 1 - t
    out.push({
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
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
