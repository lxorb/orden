import type { Box } from './layout'

const N = 120

export const PAD = 16

export const CLEAR = 12

const RATE = 13

const BREATH = 0.8
const BREATH_RATE = 0.22
const WAVE = 0.6
const WAVES: readonly { lobes: number; rate: number; phase: number }[] = [
  { lobes: 2, rate: 0.09, phase: 0 },
  { lobes: 3, rate: -0.13, phase: 1.7 },
  { lobes: 5, rate: 0.17, phase: 4.1 },
]

const SEAM = 4

const STEP = 8

const TAU = 2 * Math.PI
const COS = Float64Array.from({ length: N }, (_, i) => Math.cos((i / N) * TAU))
const SIN = Float64Array.from({ length: N }, (_, i) => Math.sin((i / N) * TAU))

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
      const far =
        cx * c + cy * s + (Math.abs(a * c) ** DUAL + Math.abs(b * s) ** DUAL) ** (1 / DUAL)
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
    for (let k = -SOFT; k <= SOFT; k++)
      sum += (own[(i + k + N) % N] ?? 0) * (SOFTNESS[k + SOFT] ?? 0)
    out[i] = sum / SOFT_SUM
    short = Math.max(short, (own[i] ?? 0) - (out[i] ?? 0))
  }
  for (let i = 0; i < N; i++) out[i] = (out[i] ?? 0) + short + x * (COS[i] ?? 0) + y * (SIN[i] ?? 0)
  return out
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
  private readonly h = new Float64Array(N)
  private readonly speed = new Float64Array(N)
  private readonly shown = new Float64Array(N)
  private goal: Float64Array = new Float64Array(N)
  private floor: Float64Array = new Float64Array(N)
  private edges: Edge[] = []
  private outline: Point[] = []

  constructor(boxes: readonly Box[]) {
    this.aim(boxes)
    this.h.set(this.goal)
    this.shown.set(this.goal)
    this.draw(0, true)
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

  private middle(): { x: number; y: number } {
    const at = (share: number) => this.shown[Math.round(share * N) % N] ?? 0
    return { x: (at(0) - at(0.5)) / 2, y: (at(0.25) - at(0.75)) / 2 }
  }

  step(seconds: number, t: number, boxes: readonly Box[], still = false) {
    this.aim(boxes)
    const dt = Math.min(Math.max(seconds, 0), 0.05)
    const fade = Math.exp(-RATE * dt)
    for (let i = 0; i < N; i++) {
      const goal = this.goal[i] ?? 0
      if (still) {
        this.h[i] = goal
        this.speed[i] = 0
        continue
      }
      const off = (this.h[i] ?? 0) - goal
      const v = this.speed[i] ?? 0
      const lead = v + RATE * off
      this.h[i] = goal + (off + lead * dt) * fade
      this.speed[i] = (v - RATE * lead * dt) * fade
    }
    for (let i = 0; i < N; i++) this.shown[i] = Math.max(this.h[i] ?? 0, this.floor[i] ?? 0)
    this.edges = []
    this.draw(t, still)
  }

  private t = 0
  private still = false

  private draw(t: number, still: boolean) {
    this.t = t
    this.still = still
    let points = even(hullOf(this.shown))
    if (!still) {
      const { x, y } = this.middle()
      const breath = BREATH * Math.sin(t * BREATH_RATE * TAU)
      points = points.map(([px, py]) => {
        const angle = Math.atan2(py - y, px - x)
        let rest = breath
        for (const wave of WAVES)
          rest += WAVE * Math.sin(angle * wave.lobes + t * wave.rate * TAU + wave.phase)
        const far = Math.hypot(px - x, py - y) || 1
        return [px + ((px - x) / far) * rest, py + ((py - y) / far) * rest]
      })
    }
    for (const edge of this.edges) points = cut(points, edge)
    this.outline = even(points)
  }

  meet(edge: Edge) {
    this.edges.push(edge)
    this.draw(this.t, this.still)
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
      out.push([
        bx,
        by,
        bx + (cx - ax) / 6,
        by + (cy - ay) / 6,
        cx - (ex - bx) / 6,
        cy - (ey - by) / 6,
        cx,
        cy,
      ])
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

export function apart(
  one: Bubble,
  other: Bubble,
  ones: readonly Box[],
  others: readonly Box[],
): void {
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
  const reach = one.reach(best)
  const back = -other.reach(best + N / 2)
  if (reach + SEAM <= back - SEAM) return
  const x = COS[best] ?? 0
  const y = SIN[best] ?? 0
  const from = near[best] ?? 0
  const middle = from + widest / 2
  const clear = Math.min(SEAM, widest / 2)
  one.meet({ x, y, at: middle - clear })
  other.meet({ x: -x, y: -y, at: -(middle + clear) })
}
