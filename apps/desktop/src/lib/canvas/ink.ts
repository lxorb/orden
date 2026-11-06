import { getStroke } from 'perfect-freehand'
import type { Felt, PenTraits, Reported } from './contacts'
import { freshId, type InkPoint, type InkStroke, type InkTool } from './format'
import { awayFromSegment, type Box, type Point } from './geometry'

export interface InkStyle {
  thinning: number
  smoothing: number
  streamline: number
  opacity: number
  multiply: boolean
  taper: number
  nib: number | null
  grain: boolean
  size: number
}

export const INK_STYLES: Record<InkTool, InkStyle> = {
  pen: {
    thinning: 0.12,
    smoothing: 0.5,
    streamline: 0.5,
    opacity: 1,
    multiply: false,
    taper: 0,
    nib: null,
    grain: false,
    size: 3,
  },
  fountain: {
    thinning: 0.75,
    smoothing: 0.55,
    streamline: 0.45,
    opacity: 1,
    multiply: false,
    taper: 12,
    nib: null,
    grain: false,
    size: 4,
  },
  pencil: {
    thinning: 0.45,
    smoothing: 0.4,
    streamline: 0.35,
    opacity: 0.9,
    multiply: true,
    taper: 4,
    nib: null,
    grain: true,
    size: 3.5,
  },
  marker: {
    thinning: 0,
    smoothing: 0.6,
    streamline: 0.55,
    opacity: 0.95,
    multiply: false,
    taper: 0,
    nib: null,
    grain: false,
    size: 8,
  },
  highlighter: {
    thinning: 0,
    smoothing: 0.7,
    streamline: 0.6,
    opacity: 0.32,
    multiply: true,
    taper: 0,
    nib: null,
    grain: false,
    size: 18,
  },
  brush: {
    thinning: 0.85,
    smoothing: 0.6,
    streamline: 0.4,
    opacity: 0.95,
    multiply: false,
    taper: 26,
    nib: null,
    grain: false,
    size: 7,
  },
  calligraphy: {
    thinning: 0.3,
    smoothing: 0.5,
    streamline: 0.45,
    opacity: 1,
    multiply: false,
    taper: 0,
    nib: -40,
    grain: false,
    size: 9,
  },
}

export function inkOpacity(stroke: InkStroke): number {
  return stroke.opacity ?? INK_STYLES[stroke.tool].opacity
}

const MIDDLE = 0.5

export function forceOf(reported: number, gain: number): number {
  if (!(reported > 0)) return MIDDLE

  return Math.min(1, reported ** gain)
}

const NEARLY_FLAT = 1e-6

const DEGREES = 180 / Math.PI

export function tiltOf(event: Felt): { tiltX: number; tiltY: number } {
  if (event.tiltX !== 0 || event.tiltY !== 0) return { tiltX: event.tiltX, tiltY: event.tiltY }

  const up = event.altitudeAngle
  if (typeof up !== 'number' || up >= Math.PI / 2) return { tiltX: 0, tiltY: 0 }

  const round = event.azimuthAngle ?? 0
  const tan = Math.tan(Math.max(up, NEARLY_FLAT))
  const degrees = (radians: number) => Math.round(radians * DEGREES) || 0

  return {
    tiltX: degrees(Math.atan(Math.cos(round) / tan)),
    tiltY: degrees(Math.atan(Math.sin(round) / tan)),
  }
}

const LEVEL = { tiltX: 0, tiltY: 0 }

export function penFelt(
  event: Reported & Felt,
  traits: PenTraits,
): { pressure: number; tiltX: number; tiltY: number } {
  const pen = event.pointerType === 'pen'
  const said = pen && traits.force === 'flat' ? 0 : event.pressure

  return {
    pressure: forceOf(said, pen ? traits.gain : 1),
    ...(pen ? tiltOf(event) : LEVEL),
  }
}

export function outlineOf(stroke: InkStroke, finished = true): Point[] {
  const style = INK_STYLES[stroke.tool]
  const said = smoothed(stroke.points, stroke.size)
  if (style.nib !== null) return ribbon(said, stroke.size, style)

  const dot = stroke.points.length === 1
  const points = evenly(said).map((point) => [point.x, point.y, point.pressure])
  const taper = (style.taper * stroke.size) / style.size
  const ring = getStroke(points, {
    size: stroke.size,
    thinning: style.thinning,
    smoothing: style.smoothing,
    streamline: style.streamline,
    simulatePressure: false,
    last: finished,
    ...(style.taper && !dot
      ? { start: { taper }, end: { taper } }
      : { start: { cap: true }, end: { cap: true } }),
  })

  return ring.map(([x, y]) => ({ x, y }))
}

const LEAD = 1

const STRAIGHT_ENOUGH = 0.7

export function leadPoint(
  before: InkPoint | undefined,
  nib: InkPoint | undefined,
  guessed: readonly InkPoint[],
): InkPoint[] {
  const guess = guessed[0]
  if (!nib || !before || !guess) return []

  const wasX = nib.x - before.x
  const wasY = nib.y - before.y
  const step = Math.hypot(wasX, wasY)
  if (step === 0) return []

  const aheadX = guess.x - nib.x
  const aheadY = guess.y - nib.y
  const ahead = Math.hypot(aheadX, aheadY)
  if (ahead === 0) return []

  const along = (wasX * aheadX + wasY * aheadY) / (step * ahead)
  if (along < STRAIGHT_ENOUGH) return []

  const most = step * LEAD
  const held = Math.min(1, most / ahead)

  return [
    {
      ...guess,
      x: nib.x + aheadX * held,
      y: nib.y + aheadY * held,
    },
  ]
}

const STEP = 1

const MOST = 2000

function evenly(points: readonly InkPoint[]): InkPoint[] {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 3) return [...points]

  let length = 0
  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to) length += Math.hypot(to.x - from.x, to.y - from.y)
  }

  const step = Math.max(STEP, length / MOST)
  const walked: InkPoint[] = [first]
  let over = 0

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (!from || !to) continue

    const span = Math.hypot(to.x - from.x, to.y - from.y)
    if (span === 0) continue

    for (let at = step - over; at < span; at += step) {
      walked.push(between(from, to, at / span))
    }

    over = (over + span) % step
  }

  walked.push(last)
  return walked
}

const COARSE = 1.2

const MOST_ON_A_STEP = 8

export function smoothed(points: readonly InkPoint[], size: number): readonly InkPoint[] {
  if (points.length < 3) return points

  const most = Math.max(size * COARSE, STEP)
  let coarse = false
  for (let one = 1; one < points.length && !coarse; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to && Math.hypot(to.x - from.x, to.y - from.y) > most) coarse = true
  }

  if (!coarse) return points

  const out: InkPoint[] = []

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (!from || !to) continue

    out.push(from)

    const span = Math.hypot(to.x - from.x, to.y - from.y)
    if (span <= most) continue

    const before = steering(points[one - 2], from, to)
    const after = steering(points[one + 1], to, from)
    const many = Math.min(MOST_ON_A_STEP, Math.ceil(span / most) - 1)

    for (let at = 1; at <= many; at++) {
      out.push(curved(before, from, to, after, at / (many + 1)))
    }
  }

  const last = points[points.length - 1]
  if (last) out.push(last)

  return out
}

function steering(came: InkPoint | undefined, from: InkPoint, to: InkPoint): InkPoint {
  if (!came) return mirrored(from, to)

  const inX = from.x - came.x
  const inY = from.y - came.y
  const outX = to.x - from.x
  const outY = to.y - from.y
  const along =
    (inX * outX + inY * outY) / Math.max(TINY, Math.hypot(inX, inY) * Math.hypot(outX, outY))

  return along < STRAIGHT_ENOUGH ? mirrored(from, to) : came
}

function mirrored(from: InkPoint, to: InkPoint): InkPoint {
  return { ...from, x: 2 * from.x - to.x, y: 2 * from.y - to.y }
}

const TINY = 1e-6

function curved(
  before: InkPoint,
  from: InkPoint,
  to: InkPoint,
  after: InkPoint,
  share: number,
): InkPoint {
  const span = (a: InkPoint, b: InkPoint) =>
    Math.max(TINY, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
  const first = span(before, from)
  const middle = span(from, to)
  const last = span(to, after)

  const dx = to.x - from.x
  const dy = to.y - from.y

  const fromX = dx + middle * ((from.x - before.x) / first - (to.x - before.x) / (first + middle))
  const fromY = dy + middle * ((from.y - before.y) / first - (to.y - before.y) / (first + middle))
  const toX = dx + middle * ((after.x - to.x) / last - (after.x - from.x) / (middle + last))
  const toY = dy + middle * ((after.y - to.y) / last - (after.y - from.y) / (middle + last))

  const t = share
  const t2 = t * t
  const t3 = t2 * t
  const here = 2 * t3 - 3 * t2 + 1
  const there = -2 * t3 + 3 * t2
  const leaving = t3 - 2 * t2 + t
  const arriving = t3 - t2

  return {
    ...between(from, to, share),
    x: here * from.x + there * to.x + leaving * fromX + arriving * toX,
    y: here * from.y + there * to.y + leaving * fromY + arriving * toY,
  }
}

function between(from: InkPoint, to: InkPoint, share: number): InkPoint {
  const mix = (a: number, b: number) => a + (b - a) * share

  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    pressure: mix(from.pressure, to.pressure),
    tiltX: mix(from.tiltX, to.tiltX),
    tiltY: mix(from.tiltY, to.tiltY),
    t: Math.round(mix(from.t, to.t)),
  }
}

export interface InkSink {
  moveTo(x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  closePath(): void
}

export function traceInk(ring: readonly Point[], sink: InkSink): void {
  const count = ring.length
  if (count < 3) return

  const first = ring[0]
  const last = ring[count - 1]
  if (!first || !last) return

  sink.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)

  for (let one = 0; one < count; one++) {
    const at = ring[one]
    const next = ring[(one + 1) % count]
    if (!at || !next) continue

    sink.quadraticCurveTo(at.x, at.y, (at.x + next.x) / 2, (at.y + next.y) / 2)
  }

  sink.closePath()
}

export function inkPath(ring: readonly Point[]): string {
  const out: string[] = []
  const round = (value: number) => Math.round(value * 10) / 10

  traceInk(ring, {
    moveTo: (x, y) => out.push(`M${round(x)} ${round(y)}`),
    quadraticCurveTo: (cx, cy, x, y) =>
      out.push(`Q${round(cx)} ${round(cy)} ${round(x)} ${round(y)}`),
    closePath: () => out.push('Z'),
  })

  return out.join(' ')
}

const NIB_DEPTH = 0.16

function ribbon(points: readonly InkPoint[], size: number, style: InkStyle): Point[] {
  const angle = ((style.nib ?? 0) * Math.PI) / 180
  const half = size / 2
  const ax = Math.cos(angle)
  const ay = Math.sin(angle)

  const only = points.length === 1 ? points[0] : undefined
  if (only) {
    const width = half * (1 - style.thinning * (1 - only.pressure))
    const depth = (size * NIB_DEPTH) / 2
    const bx = -ay * depth
    const by = ax * depth

    return [
      { x: only.x + ax * width + bx, y: only.y + ay * width + by },
      { x: only.x - ax * width + bx, y: only.y - ay * width + by },
      { x: only.x - ax * width - bx, y: only.y - ay * width - by },
      { x: only.x + ax * width - bx, y: only.y + ay * width - by },
    ]
  }

  const forward: Point[] = []
  const back: Point[] = []

  for (const point of points) {
    const width = half * (1 - style.thinning * (1 - point.pressure))
    forward.push({ x: point.x + ax * width, y: point.y + ay * width })
    back.unshift({ x: point.x - ax * width, y: point.y - ay * width })
  }

  return [...forward, ...back]
}

const boxes = new WeakMap<InkStroke, Box>()

export function strokeBox(stroke: InkStroke): Box {
  const held = boxes.get(stroke)
  if (held) return held

  const box = measured(stroke)
  boxes.set(stroke, box)
  return box
}

function measured(stroke: InkStroke): Box {
  const points = smoothed(stroke.points, stroke.size)
  const [first] = points
  if (!first) return { x: 0, y: 0, width: 0, height: 0 }

  let least = first.x
  let most = first.x
  let lowest = first.y
  let highest = first.y

  for (const point of points) {
    if (point.x < least) least = point.x
    if (point.x > most) most = point.x
    if (point.y < lowest) lowest = point.y
    if (point.y > highest) highest = point.y
  }

  const room = stroke.size
  return {
    x: least - room,
    y: lowest - room,
    width: most - least + 2 * room,
    height: highest - lowest + 2 * room,
  }
}

const TOLERANCE = 0.12

const FURTHEST = 0.3

export function simplified(points: readonly InkPoint[], tolerance: number, swell = 0): InkPoint[] {
  if (points.length < 3) return [...points]

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length) {
    const span = stack.pop()
    if (!span) break

    const [from, to] = span
    const start = points[from]
    const end = points[to]
    if (!start || !end || to - from < 2) continue

    let worst = -1
    let at = -1

    for (let one = from + 1; one < to; one++) {
      const point = points[one]
      if (!point) continue

      const share = (one - from) / (to - from)
      const guessed = start.pressure + (end.pressure - start.pressure) * share
      const away = awayFromSegment(point, start, end) + swell * Math.abs(point.pressure - guessed)

      if (away > worst) {
        worst = away
        at = one
      }
    }

    if (at < 0 || worst <= tolerance) continue

    keep[at] = 1
    stack.push([from, at], [at, to])
  }

  return points.filter((_point, index) => keep[index] === 1)
}

export function tidied(stroke: InkStroke): InkStroke {
  const swell = (stroke.size * INK_STYLES[stroke.tool].thinning) / 2

  return {
    ...stroke,
    points: simplified(stroke.points, Math.min(stroke.size * TOLERANCE, FURTHEST), swell),
  }
}

export function nearStroke(stroke: InkStroke, point: Point, reach: number): boolean {
  const room = reach + stroke.size / 2
  const box = strokeBox(stroke)
  if (
    point.x < box.x - room ||
    point.x > box.x + box.width + room ||
    point.y < box.y - room ||
    point.y > box.y + box.height + room
  ) {
    return false
  }

  const points = stroke.points
  if (points.length === 1) {
    const only = points[0]
    return !!only && Math.hypot(point.x - only.x, point.y - only.y) <= room
  }

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to && awayFromSegment(point, from, to) <= room) return true
  }

  return false
}

function underCircle(
  from: Point,
  to: Point,
  centre: Point,
  radius: number,
): { enters: number; leaves: number } | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const fx = from.x - centre.x
  const fy = from.y - centre.y

  const a = dx * dx + dy * dy
  const c = fx * fx + fy * fy - radius * radius
  if (a === 0) return c <= 0 ? { enters: 0, leaves: 1 } : null

  const b = fx * dx + fy * dy
  const root = b * b - a * c
  if (root <= 0) return null

  const enters = (-b - Math.sqrt(root)) / a
  const leaves = (-b + Math.sqrt(root)) / a
  if (leaves <= 0 || enters >= 1) return null

  return { enters: Math.max(0, enters), leaves: Math.min(1, leaves) }
}

function pointBetween(from: InkPoint, to: InkPoint, share: number): InkPoint {
  const at = (one: number, other: number) => one + (other - one) * share

  return {
    x: at(from.x, to.x),
    y: at(from.y, to.y),
    pressure: at(from.pressure, to.pressure),
    tiltX: at(from.tiltX, to.tiltX),
    tiltY: at(from.tiltY, to.tiltY),
    t: at(from.t, to.t),
  }
}

export function rubbedPath(from: Point, to: Point, reach: number): Point[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const step = Math.max(reach, MIN_REACH) / 2
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step))

  return Array.from({ length: steps }, (_unused, step) =>
    step + 1 === steps
      ? to
      : { x: from.x + (dx * (step + 1)) / steps, y: from.y + (dy * (step + 1)) / steps },
  )
}

const HAND_SLACK = 2

export function rubbedBetween(
  before: { at: Point; screen: Point },
  now: { at: Point; screen: Point },
  scale: number,
  reach: number,
): Point[] {
  const onPlane = Math.hypot(now.at.x - before.at.x, now.at.y - before.at.y) * scale
  const onScreen = Math.hypot(now.screen.x - before.screen.x, now.screen.y - before.screen.y)

  return onPlane > onScreen + HAND_SLACK ? [now.at] : rubbedPath(before.at, now.at, reach)
}

const MIN_REACH = 0.01

export function erased(stroke: InkStroke, at: Point, reach: number): InkStroke[] {
  const room = reach + stroke.size / 2
  const [only] = stroke.points

  if (only && stroke.points.length === 1) {
    return Math.hypot(only.x - at.x, only.y - at.y) <= room ? [] : [stroke]
  }

  const pieces: InkPoint[][] = []
  let piece: InkPoint[] = []
  let touched = false

  for (let one = 1; one < stroke.points.length; one++) {
    const from = stroke.points[one - 1]
    const to = stroke.points[one]
    if (!from || !to) continue

    const under = underCircle(from, to, at, room)
    if (!under) {
      if (!piece.length) piece.push(from)
      piece.push(to)
      continue
    }

    touched = true
    if (under.enters > 0) {
      if (!piece.length) piece.push(from)
      piece.push(pointBetween(from, to, under.enters))
    }
    if (piece.length > 1) pieces.push(piece)
    piece = under.leaves < 1 ? [pointBetween(from, to, under.leaves), to] : []
  }

  if (piece.length > 1) pieces.push(piece)

  if (!touched) return [stroke]

  return pieces.map((points, index) => ({
    ...stroke,
    id: index === 0 ? stroke.id : freshId(),
    points: retimed(points),
  }))
}

function retimed(points: readonly InkPoint[]): InkPoint[] {
  const [first] = points
  if (!first) return []

  return points.map((point) => ({ ...point, t: point.t - first.t }))
}

export function insidePolygon(polygon: readonly Point[], point: Point): boolean {
  let inside = false

  for (let one = 0, other = polygon.length - 1; one < polygon.length; other = one++) {
    const a = polygon[one]
    const b = polygon[other]
    if (!a || !b) continue

    if (a.y > point.y !== b.y > point.y) {
      const across = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      if (point.x < across) inside = !inside
    }
  }

  return inside
}

export function strokesInLasso(
  strokes: readonly InkStroke[],
  lasso: readonly Point[],
  partly = false,
): string[] {
  if (lasso.length < 3) return []

  return strokes
    .filter((stroke) =>
      partly
        ? stroke.points.some((point) => insidePolygon(lasso, point))
        : stroke.points.every((point) => insidePolygon(lasso, point)),
    )
    .map((stroke) => stroke.id)
}

export function cardsInLasso(
  nodes: readonly { id: string; x: number; y: number; width: number; height: number }[],
  lasso: readonly Point[],
  partly = false,
): string[] {
  if (lasso.length < 3) return []

  return nodes
    .filter((node) => {
      const corners = [
        { x: node.x, y: node.y },
        { x: node.x + node.width, y: node.y },
        { x: node.x, y: node.y + node.height },
        { x: node.x + node.width, y: node.y + node.height },
      ]
      return partly
        ? insidePolygon(lasso, { x: node.x + node.width / 2, y: node.y + node.height / 2 })
        : corners.every((corner) => insidePolygon(lasso, corner))
    })
    .map((node) => node.id)
}

export interface InkTransform {
  dx: number
  dy: number
  sx: number
  sy: number
  turn: number
  about: Point
}

export function transformed(stroke: InkStroke, by: InkTransform): InkStroke {
  const cos = Math.cos(by.turn)
  const sin = Math.sin(by.turn)

  return {
    ...stroke,
    size: stroke.size * Math.min(Math.abs(by.sx), Math.abs(by.sy)),
    points: stroke.points.map((point) => {
      const x = (point.x - by.about.x) * by.sx
      const y = (point.y - by.about.y) * by.sy

      return {
        ...point,
        x: by.about.x + x * cos - y * sin + by.dx,
        y: by.about.y + x * sin + y * cos + by.dy,
      }
    }),
  }
}

const STRAIGHT = 0.06
const CLOSED = 0.22
const ROUND = 0.08

export type Assisted = 'line' | 'ellipse' | 'rectangle'

export function assisted(stroke: InkStroke): Assisted | null {
  const points = stroke.points
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 6) return null

  const box = strokeBox(stroke)
  const across = box.width - 2 * stroke.size
  const down = box.height - 2 * stroke.size
  const span = Math.hypot(across, down)
  if (span < stroke.size * 4) return null

  const ends = Math.hypot(last.x - first.x, last.y - first.y)

  if (ends > span * CLOSED) {
    let worst = 0
    for (const point of points) worst = Math.max(worst, awayFromSegment(point, first, last))

    return worst <= ends * STRAIGHT ? 'line' : null
  }

  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const radii = points.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y))
  const mean = radii.reduce((sum, one) => sum + one, 0) / radii.length
  if (mean === 0) return null

  const spread =
    Math.sqrt(radii.reduce((sum, one) => sum + (one - mean) ** 2, 0) / radii.length) / mean

  return spread <= ROUND ? 'ellipse' : 'rectangle'
}

const SIDES = 64

export function tidyShape(stroke: InkStroke, shape: Assisted): InkStroke {
  const box = strokeBox(stroke)
  const room = stroke.size
  const inner = {
    x: box.x + room,
    y: box.y + room,
    width: Math.max(0, box.width - 2 * room),
    height: Math.max(0, box.height - 2 * room),
  }

  const last = stroke.points[stroke.points.length - 1]
  const span = last?.t ?? 0
  const at = (points: Point[]): InkStroke => ({
    ...stroke,
    points: points.map((point, index) => ({
      ...point,
      pressure: 0.6,
      tiltX: 0,
      tiltY: 0,
      t: Math.round((span * index) / Math.max(1, points.length - 1)),
    })),
  })

  switch (shape) {
    case 'line': {
      const first = stroke.points[0]
      if (!first || !last) return stroke
      return at([
        { x: first.x, y: first.y },
        { x: last.x, y: last.y },
      ])
    }
    case 'rectangle':
      return at([
        { x: inner.x, y: inner.y },
        { x: inner.x + inner.width, y: inner.y },
        { x: inner.x + inner.width, y: inner.y + inner.height },
        { x: inner.x, y: inner.y + inner.height },
        { x: inner.x, y: inner.y },
      ])
    case 'ellipse': {
      const middle = { x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 }
      const points: Point[] = []
      for (let one = 0; one <= SIDES; one++) {
        const angle = (one / SIDES) * Math.PI * 2
        points.push({
          x: middle.x + (Math.cos(angle) * inner.width) / 2,
          y: middle.y + (Math.sin(angle) * inner.height) / 2,
        })
      }
      return at(points)
    }
  }
}
