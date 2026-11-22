import type { Box } from './layout'

export const N = 120
export const PAD = 16
export const CLEAR = 12
const SEAM = 4
const STEP = 8
const TAU = 2 * Math.PI
const WOBBLE = 6
const SWAYS = 36
export const SWAY_MS = 9000
export const COS = Float64Array.from({ length: N }, (_, i) => Math.cos((i / N) * TAU))
export const SIN = Float64Array.from({ length: N }, (_, i) => Math.sin((i / N) * TAU))
function reachOf(boxes: readonly Box[], by: number): Float64Array | null {
  if (!boxes.length) return null
  const out = new Float64Array(N).fill(Number.NEGATIVE_INFINITY)
  for (const box of boxes) {
    for (const [x, y] of [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x, box.y + box.h],
      [box.x + box.w, box.y + box.h],
    ] as const) {
      for (let i = 0; i < N; i++) {
        const far = x * (COS[i] ?? 0) + y * (SIN[i] ?? 0)
        if (far > (out[i] ?? 0)) out[i] = far
      }
    }
  }
  for (let i = 0; i < N; i++) out[i] = (out[i] ?? 0) + by
  return out
}
const ROUND = 4
const DUAL = ROUND / (ROUND - 1)
const SWELL = 2 ** (1 / ROUND)
function roundOf(boxes: readonly Box[], by = PAD): Float64Array | null {
  if (!boxes.length) return null
  const out = new Float64Array(N).fill(Number.NEGATIVE_INFINITY)
  for (const box of boxes) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const a = (box.w / 2 + by) * SWELL
    const b = (box.h / 2 + by) * SWELL
    for (let i = 0; i < N; i++) {
      const c = COS[i] ?? 0
      const s = SIN[i] ?? 0
      const far = cx * c + cy * s + (Math.abs(a * c) ** DUAL + Math.abs(b * s) ** DUAL) ** (1 / DUAL)
      if (far > (out[i] ?? 0)) out[i] = far
    }
  }
  return out
}
const SOFT = Math.round((N * 0.4) / TAU)
const SOFTNESS = Float64Array.from({ length: 2 * SOFT + 1 }, (_, k) => {
  const at = (k - SOFT) / (SOFT + 1)
  return 0.5 + 0.5 * Math.cos(Math.PI * at)
})
const SOFT_SUM = SOFTNESS.reduce((sum, one) => sum + one, 0)
function softened(h: Float64Array): Float64Array {
  const at = (share: number) => h[Math.round(share * N) % N] ?? 0
  const x = (at(0) - at(0.5)) / 2
  const y = (at(0.25) - at(0.75)) / 2
  const own = Float64Array.from(h, (one, i) => one - x * (COS[i] ?? 0) - y * (SIN[i] ?? 0))
  const out = new Float64Array(N)
  let short = 0
  for (let i = 0; i < N; i++) {
    let sum = 0
    for (let k = -SOFT; k <= SOFT; k++) sum += (own[(i + k + N) % N] ?? 0) * (SOFTNESS[k + SOFT] ?? 0)
    out[i] = sum / SOFT_SUM
    short = Math.max(short, (own[i] ?? 0) - (out[i] ?? 0))
  }
  for (let i = 0; i < N; i++) out[i] = (out[i] ?? 0) + short + x * (COS[i] ?? 0) + y * (SIN[i] ?? 0)
  return out
}
export function restingOf(boxes: readonly Box[]): Float64Array | null {
  const round = roundOf(boxes)
  return round && softened(round)
}
export function grownOf(box: Box): Box {
  const round = roundOf([box])
  if (!round) return box
  const h = softened(round)
  const at = (share: number) => h[Math.round(share * N) % N] ?? 0
  const left = -at(0.5)
  const top = -at(0.75)
  return { x: left, y: top, w: at(0) - left, h: at(0.25) - top }
}
interface Edge {
  x: number
  y: number
  at: number
}
interface Press extends Edge {
  from: number
  bend: number
  middle: number
}
type Point = [number, number]
function hullOf(h: Float64Array): Point[] {
  const at = (share: number) => h[Math.round(share * N) % N] ?? 0
  let points: Point[] = [
    [-at(0.5), -at(0.75)],
    [at(0), -at(0.75)],
    [at(0), at(0.25)],
    [-at(0.5), at(0.25)],
  ]
  for (let i = 0; i < N; i++) {
    if (i % (N / 4) === 0) continue
    points = cut(points, { x: COS[i] ?? 0, y: SIN[i] ?? 0, at: h[i] ?? 0 })
  }
  return points
}
function cut(points: readonly Point[], edge: Edge): Point[] {
  const out: Point[] = []
  const side = ([x, y]: Point) => x * edge.x + y * edge.y - edge.at
  for (let i = 0; i < points.length; i++) {
    const a = points[i] ?? [0, 0]
    const b = points[(i + 1) % points.length] ?? [0, 0]
    const sa = side(a)
    const sb = side(b)
    if (sa <= 0) out.push(a)
    if (sa <= 0 !== sb <= 0) {
      const f = sa / (sa - sb)
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    }
  }
  return out
}
function pressed(points: readonly Point[], press: Press): Point[] {
  const { x, y, at, from, bend, middle } = press
  let reach = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const [px, py] of points) {
    reach = Math.max(reach, px * x + py * y)
    low = Math.min(low, py * x - px * y)
    high = Math.max(high, py * x - px * y)
  }
  const over = reach - at
  if (over <= 0) return [...points]
  const span = reach - from
  if (span <= over)
    return points.map(([px, py]): Point => {
      const by = Math.max(0, px * x + py * y - at)
      return [px - by * x, py - by * y]
    })
  const most = span / over
  const c = Math.min(2, Math.max(1, 0.75 * most))
  const steep = c >= 1.5 ? c : (3 - c) ** 2 / (3 * (2 - c))
  const smooth = steep < 0.95 * most
  const power = (1 + most) / 2
  const ease = (u: number) => (smooth ? (3 - c) * u * u + (c - 2) * u * u * u : u ** power)
  const bent = Math.max(0, Math.min(bend, 2 * over, 0.9 * (span / (smooth ? steep : power) - over)))
  const half = Math.max(high - middle, middle - low) || 1
  return points.map(([px, py]): Point => {
    const share = (px * x + py * y - from) / span
    if (share <= 0) return [px, py]
    const across = (py * x - px * y - middle) / half
    const by = ease(Math.min(share, 1)) * (over + bent * across * across)
    return [px - by * x, py - by * y]
  })
}
function even(points: readonly Point[]): Point[] {
  const n = points.length
  if (n < 3) return [...points]
  const along = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const a = points[i] ?? [0, 0]
    const b = points[(i + 1) % n] ?? [0, 0]
    along[i + 1] = (along[i] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const total = along[n] ?? 0
  const count = Math.max(12, Math.ceil(total / STEP))
  const out: Point[] = []
  let at = 0
  for (let k = 0; k < count; k++) {
    const want = (k / count) * total
    while (at < n - 1 && (along[at + 1] ?? 0) < want) at++
    const a = points[at] ?? [0, 0]
    const b = points[(at + 1) % n] ?? [0, 0]
    const span = (along[at + 1] ?? 0) - (along[at] ?? 0)
    const f = span > 0 ? (want - (along[at] ?? 0)) / span : 0
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  return out
}
export class Bubble {
  private readonly shown = new Float64Array(N)
  private goal: Float64Array = new Float64Array(N)
  private floor: Float64Array = new Float64Array(N)
  private presses: Press[] = []
  private round: Point[] = []
  private outline: Point[] = []
  constructor(boxes: readonly Box[]) {
    this.aim(boxes)
    this.shown.set(this.goal)
    this.round = even(hullOf(this.shown))
    this.draw()
  }
  private aim(boxes: readonly Box[]) {
    const tight = roundOf(boxes)
    const goal = tight && softened(tight)
    const floor = roundOf(boxes, CLEAR)
    if (goal && floor) {
      this.goal = goal
      this.floor = floor
      return
    }
    const { x, y } = this.middle()
    for (let i = 0; i < N; i++) {
      const far = x * (COS[i] ?? 0) + y * (SIN[i] ?? 0)
      this.goal[i] = far + PAD
      this.floor[i] = Number.NEGATIVE_INFINITY
    }
  }
  middle(): { x: number; y: number } {
    const at = (share: number) => this.shown[Math.round(share * N) % N] ?? 0
    return { x: (at(0) - at(0.5)) / 2, y: (at(0.25) - at(0.75)) / 2 }
  }
  size(): number {
    const at = (share: number) => this.shown[Math.round(share * N) % N] ?? 0
    return Math.max(at(0) + at(0.5), at(0.25) + at(0.75)) / 2
  }
  step(boxes: readonly Box[]) {
    this.aim(boxes)
    for (let i = 0; i < N; i++) this.shown[i] = Math.max(this.goal[i] ?? 0, this.floor[i] ?? 0)
    this.presses = []
    this.round = even(hullOf(this.shown))
    this.draw()
  }
  private draw() {
    let points = this.round
    for (const press of this.presses) points = pressed(points, press)
    this.outline = even(points)
  }
  press(one: Press) {
    this.presses.push(one)
    this.draw()
  }
  reach(i: number): number {
    return this.shown[((i % N) + N) % N] ?? 0
  }
  points(): readonly Point[] {
    return this.outline
  }
  pathOf(): string {
    const r = (value: number) => Math.round(value * 10) / 10
    let d = ''
    for (const [index, [x0, y0, c1x, c1y, c2x, c2y, x1, y1]] of this.curves().entries()) {
      if (index === 0) d = `M${r(x0)} ${r(y0)}`
      d += `C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x1)} ${r(y1)}`
    }
    return d ? `${d}Z` : ''
  }
  curves(): [number, number, number, number, number, number, number, number][] {
    const all = this.outline
    const n = all.length
    const at = (i: number) => all[((i % n) + n) % n] ?? [0, 0]
    const out: [number, number, number, number, number, number, number, number][] = []
    for (let i = 0; i < n; i++) {
      const [ax, ay] = at(i - 1)
      const [bx, by] = at(i)
      const [cx, cy] = at(i + 1)
      const [ex, ey] = at(i + 2)
      out.push([bx, by, bx + (cx - ax) / 6, by + (cy - ay) / 6, cx - (ex - bx) / 6, cy - (ey - by) / 6, cx, cy])
    }
    return out
  }
  crown(): { x: number; y: number } {
    const all = this.outline
    if (!all.length) return { x: 0, y: 0 }
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    for (const [x, y] of all) {
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
    }
    return { x: (left + right) / 2, y: top }
  }
}
export function apart(one: Bubble, other: Bubble, ones: readonly Box[], others: readonly Box[]): void {
  const near = reachOf(ones, 0)
  const far = reachOf(others, 0)
  if (!near || !far) return
  let best = -1
  let widest = Number.NEGATIVE_INFINITY
  for (let i = 0; i < N; i++) {
    const gap = -(far[(i + N / 2) % N] ?? 0) - (near[i] ?? 0)
    if (gap > widest) {
      widest = gap
      best = i
    }
  }
  if (best < 0 || widest <= 0) return
  const x = COS[best] ?? 0
  const y = SIN[best] ?? 0
  const middle = (near[best] ?? 0) + widest / 2
  const clear = Math.min(SEAM, widest / 2)
  const margin = Math.min(CLEAR / 2, widest / 2 - clear)
  const bend = Math.max(0, widest / 2 - clear - margin)
  const across =
    (Math.max(-one.reach(best - N / 4), -other.reach(best - N / 4)) +
      Math.min(one.reach(best + N / 4), other.reach(best + N / 4))) /
    2
  if (one.reach(best) > middle - clear)
    one.press({ x, y, at: middle - clear, from: (near[best] ?? 0) + margin, bend, middle: across })
  if (-other.reach(best + N / 2) < middle + clear)
    other.press({
      x: -x,
      y: -y,
      at: -(middle + clear),
      from: (far[(best + N / 2) % N] ?? 0) + margin,
      bend,
      middle: -across,
    })
}
export function wobbleOf(size: number, seed: number): Keyframe[] {
  const by = Math.min(WOBBLE / Math.max(size, 1), 0.03)
  const turn = (by * 90) / Math.PI
  const p = seed * TAU
  return Array.from({ length: SWAYS + 1 }, (_, k) => {
    const a = (k / SWAYS) * TAU
    const sx = 1 + by * (0.6 * Math.sin(a + p) + 0.4 * Math.sin(3 * a + 2 * p))
    const sy = 1 + by * (0.6 * Math.sin(a + p + 2.1) + 0.4 * Math.sin(2 * a + 3 * p))
    const rotate = turn * Math.sin(2 * a + p + 1.3)
    return { transform: `rotate(${rotate.toFixed(4)}deg) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})` }
  })
}
