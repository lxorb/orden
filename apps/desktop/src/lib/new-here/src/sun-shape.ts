export const HUB = 44
export const INNER = 150
export const RING = 158
export const OUTER = 300
export const REACH = 340
export const GAP = 3
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

export function arcPath({ inner, outer, from, to }: Piece): string {
  if (outer - inner < 1) return ''
  const near = gapAt(inner)
  const far = gapAt(outer)
  if (to - from <= 2 * near) return ''
  const wide = to - from > 180 ? 1 : 0
  const [x0, y0] = at(outer, from + far)
  const [x1, y1] = at(outer, to - far)
  const [x2, y2] = at(inner, to - near)
  const [x3, y3] = at(inner, from + near)
  return (
    `M${fixed(x0)} ${fixed(y0)}A${outer} ${outer} 0 ${wide} 1 ${fixed(x1)} ${fixed(y1)}` +
    `L${fixed(x2)} ${fixed(y2)}A${inner} ${inner} 0 ${wide} 0 ${fixed(x3)} ${fixed(y3)}Z`
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
