export const HUB = 44
export const INNER = 150
export const RING = 162
export const OUTER = 300
export const REACH = 340
export const GAP = 6
const CORNER = 12
export const LIFT = 5
export const PULL = 110
export const SLOTS = 4
const WIDEST = 46
const FAN = 196
const WIDENED = 0.3

export type Point = readonly [number, number]
export interface Piece {
  inner: number
  outer: number
  from: number
  to: number
}

export const middleOf = (slot: number): number => slot * 90
export const spanOf = (count: number): number => Math.min(WIDEST, FAN / Math.max(1, count))
const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value))
const radians = (angle: number): number => ((angle - 90) * Math.PI) / 180

export function at(radius: number, angle: number): Point {
  return [radius * Math.cos(radians(angle)), radius * Math.sin(radians(angle))]
}
export function angleOf(x: number, y: number): number {
  return ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360
}
export function slotOf(x: number, y: number): number {
  return Math.round(angleOf(x, y) / 90) % SLOTS
}
function gapAt(radius: number): number {
  return (GAP / 2 / radius) * (180 / Math.PI)
}
const fixed = (value: number): string => value.toFixed(2)

export function arcPath({ inner, outer, from, to }: Piece, corner = CORNER): string {
  if (outer - inner < 1) return ''
  const side = GAP / 2
  if (to - from <= 2 * gapAt(inner)) return ''
  const half = Math.min(89.9, (to - from) / 2) * (Math.PI / 180)
  const sine = Math.sin(half)
  const round = Math.max(
    0,
    Math.min(corner, (outer - inner) / 2, (outer * sine - side) / (1 + sine), (inner * sine - side) / (1 - sine)),
  )
  const far = (Math.asin(Math.min(1, (side + round) / (outer - round))) * 180) / Math.PI
  const near = (Math.asin(Math.min(1, (side + round) / (inner + round))) * 180) / Math.PI
  const along = (radius: number) => Math.sqrt(Math.max(0, radius * radius - (side + round) * (side + round)))
  const edge = (angle: number, toward: number, length: number): Point => {
    const [ux, uy] = at(1, angle)
    const [nx, ny] = at(1, angle + toward)
    return [ux * length + nx * side, uy * length + ny * side]
  }
  const point = ([x, y]: Point) => `${fixed(x)} ${fixed(y)}`
  const bend = (end: Point) =>
    round > 0.01 ? `A${fixed(round)} ${fixed(round)} 0 0 1 ${point(end)}` : `L${point(end)}`
  const wideOut = to - from - 2 * far > 180 ? 1 : 0
  const wideIn = to - from - 2 * near > 180 ? 1 : 0
  return (
    `M${point(edge(from, 90, along(outer - round)))}` +
    bend(at(outer, from + far)) +
    `A${outer} ${outer} 0 ${wideOut} 1 ${point(at(outer, to - far))}` +
    bend(edge(to, -90, along(outer - round))) +
    `L${point(edge(to, -90, along(inner + round)))}` +
    bend(at(inner, to - near)) +
    `A${inner} ${inner} 0 ${wideIn} 0 ${point(at(inner, from + near))}` +
    bend(edge(from, 90, along(inner + round))) +
    'Z'
  )
}
export function quarterPiece(slot: number): Piece {
  const middle = middleOf(slot)
  return { inner: HUB, outer: INNER, from: middle - 45, to: middle + 45 }
}
export function bridgePiece(slot: number, count: number): Piece {
  const half = (count * spanOf(count)) / 2
  const middle = middleOf(slot)
  return { inner: INNER - 2, outer: RING + LIFT + 2, from: middle - half, to: middle + half }
}
export function optionPiece(
  slot: number,
  index: number,
  count: number,
  grown: number,
  lift: number,
  pull: number,
): Piece {
  const middle = middleOf(slot)
  const span = spanOf(count)
  const start = middle - (count * span) / 2 + index * span
  const fan = clamp(grown) ** 0.8
  const from = middle + (start - middle) * fan
  const to = middle + (start + span - middle) * fan
  const pulled = Math.max(0, pull)
  const half = ((to - from) / 2) * (1 + WIDENED * clamp(pulled / PULL))
  const centre = (from + to) / 2
  const inner = RING + LIFT * lift
  return { inner, outer: inner + (OUTER - RING) * grown + pulled, from: centre - half, to: centre + half }
}
export function centreOf({ inner, outer, from, to }: Piece): Point {
  return at((inner + outer) / 2, (from + to) / 2)
}
export function optionAt(slot: number, count: number, angle: number, loose: boolean): number | null {
  const half = (count * spanOf(count)) / 2
  const off = ((angle - middleOf(slot) + 540) % 360) - 180
  if (!loose && Math.abs(off) > half + 25) return null
  return clamp(Math.floor((off + half) / spanOf(count)), 0, count - 1)
}

export interface Aimed {
  open: number | null
  index: number | null
  pull: number
}
export function aimed(x: number, y: number, open: number | null, counts: readonly (number | null)[]): Aimed {
  const reach = Math.hypot(x, y)
  const angle = angleOf(x, y)
  const slot = slotOf(x, y)
  const there = counts[slot] ?? null
  if (reach < HUB) return { open: null, index: null, pull: 0 }
  if (reach < RING) return { open: there === null ? open : slot, index: null, pull: 0 }
  const held = open === null ? null : (counts[open] ?? null)
  const kept = open !== null && held !== null ? optionAt(open, held, angle, false) : null
  if (open !== null && kept !== null) return { open, index: kept, pull: Math.max(0, reach - OUTER) }
  if (there === null) return { open, index: null, pull: 0 }
  return { open: slot, index: optionAt(slot, there, angle, true), pull: Math.max(0, reach - OUTER) }
}

export function outlineOf(piece: Piece, each: number): Point[] {
  const { inner, outer, from, to } = piece
  const near = gapAt(inner)
  const far = gapAt(outer)
  const edges: ((step: number) => Point)[] = [
    (step) => at(outer, from + far + (to - far - (from + far)) * step),
    (step) => between(at(outer, to - far), at(inner, to - near), step),
    (step) => at(inner, to - near + (from + near - (to - near)) * step),
    (step) => between(at(inner, from + near), at(outer, from + far), step),
  ]
  return edges.flatMap((edge) => Array.from({ length: each }, (_, step) => edge(step / each)))
}
const CORNERS: readonly Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
export function frameOutline(slot: number, each: number): Point[] {
  return Array.from({ length: SLOTS }, (_, edge) => {
    const start = CORNERS[(slot + edge) % SLOTS] ?? [0, 0]
    const end = CORNERS[(slot + edge + 1) % SLOTS] ?? [0, 0]
    return Array.from({ length: each }, (_, step) => between(start, end, step / each))
  }).flat()
}
export function between(from: Point, to: Point, step: number): Point {
  return [from[0] + (to[0] - from[0]) * step, from[1] + (to[1] - from[1]) * step]
}
