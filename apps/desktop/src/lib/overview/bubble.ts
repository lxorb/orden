/** A space's bubble on the overview's canvas: a soft, rounded hull round its windows,
 *  and nothing more (issue #331).
 *
 *  Emil, 2026-11-04: a bubble's shape follows its members tightly and sensibly. One whose
 *  only window sits at its bottom left spanned a huge blob that grew wider away from the
 *  window, over the next bubble; and one whose only window was dragged away kept
 *  surrounding the room it had before. Its label moves with it.
 *
 *  So a bubble has no shape of its own to rest on: it is its windows. Each window has a
 *  round shape of its own, the superellipse through its corners grown by `PAD`, and the
 *  bubble rests on the hull of those (`roundOf`): one window's bubble is that window's
 *  round shape, and several windows' the least round thing round all of them. Kept as
 *  its *support*: for each of `N` directions, how far out along it the bubble reaches
 *  (`h`). That is what moves: each direction on its own critically damped spring towards
 *  where its windows' shapes reach now, so it never overshoots, and a hull that springs
 *  between two hulls is a hull again; and never nearer in than `CLEAR` past any window,
 *  so a window that is dragged, pushed or flying is inside its bubble on every frame,
 *  however the springs lag.
 *
 *  Two bubbles never overlap: where they would, both are cut flat along one line in the
 *  gap between their windows, as two soap bubbles meet (`apart`). A breath and a few
 *  slow waves of a pixel or so keep it alive. Pure but for the clock handed in. */

import type { Box } from './layout'

/** Directions round the bubble: smooth at every size one is drawn at, and cheap. */
const N = 120

/** How far the bubble stands off its windows at rest. */
export const PAD = 16

/** How near, at the least, it comes to any of them while it moves. */
export const CLEAR = 12

/** How quick a bubble follows its windows, as a critically damped spring's rate, per
 *  second: settled in about a third of a second, never past where it goes. */
const RATE = 13

/** Breathing, and three slow waves round it: a pixel or so, alive rather than wobbling. */
const BREATH = 0.8
const BREATH_RATE = 0.22
const WAVE = 0.6
const WAVES: readonly { lobes: number; rate: number; phase: number }[] = [
  { lobes: 2, rate: 0.09, phase: 0 },
  { lobes: 3, rate: -0.13, phase: 1.7 },
  { lobes: 5, rate: 0.17, phase: 4.1 },
]

/** How far each of two bubbles that meet stands off the line they meet along. */
const SEAM = 4

/** How far apart the points the outline is drawn through are, at most. */
const STEP = 8

const TAU = 2 * Math.PI
const COS = Float64Array.from({ length: N }, (_, i) => Math.cos((i / N) * TAU))
const SIN = Float64Array.from({ length: N }, (_, i) => Math.sin((i / N) * TAU))

/** How far out along each direction some boxes reach, grown by `by`; null for none. */
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

/** How round a window's own share of its bubble is: the exponent of the superellipse
 *  round it, 2 an ellipse and higher squarer - 4 is round, with its sides swelling by a
 *  fifth of the window's half-width at the most, as a cell's do. */
const ROUND = 4
/** The superellipse's dual exponent, which its reach along a direction is reckoned in. */
const DUAL = ROUND / (ROUND - 1)
const SWELL = 2 ** (1 / ROUND)

/** Where a bubble round `boxes` rests: the hull of a round shape round each window - the
 *  superellipse through its corners grown by `by` - so one window's bubble is that
 *  window's own round shape and nowhere else, and several windows' is the least round
 *  thing round all of them. Null for no boxes. Grown by `CLEAR` it is how near in the
 *  bubble may be: round too, so a window pushing at its bubble quicker than the bubble
 *  follows swells it round, and never presses its own corner into it (Emil, round 4). */
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

/** The box a bubble round `box` takes at rest, at the most: what a camera frames. */
export function grownOf(box: Box): Box {
  const x = (box.w / 2 + PAD) * SWELL
  const y = (box.h / 2 + PAD) * SWELL
  return { x: box.x + box.w / 2 - x, y: box.y + box.h / 2 - y, w: 2 * x, h: 2 * y }
}

/** The line a half-plane ends at: every point `p` with `p.x * x + p.y * y <= at`. */
interface Edge {
  x: number
  y: number
  at: number
}

type Point = [number, number]

/** The polygon a support draws: every direction's half-plane, met. Cut one at a time
 *  rather than corner to corner, so a support that is not quite a hull's - a spring
 *  half-way between two - draws its hull, and never a loop. */
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

/** A polygon less what of it is past `edge`. */
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

/** A polygon walked round at one even step of at most `STEP`: a curve through points
 *  spaced unevenly swings past the near ones, and draws a loop where a long side meets a
 *  tight corner. */
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
  /** How far out it reaches along each direction, and how fast that is changing. */
  private readonly h = new Float64Array(N)
  private readonly speed = new Float64Array(N)
  /** Its windows' round shapes, grown by `PAD`: where it goes; and by `CLEAR`: how
   *  near in it may be. */
  private goal: Float64Array = new Float64Array(N)
  private floor: Float64Array = new Float64Array(N)
  /** The lines it is cut along where it meets another bubble, this frame. */
  private edges: Edge[] = []
  /** The outline as drawn this frame. */
  private outline: Point[] = []

  constructor(boxes: readonly Box[]) {
    this.aim(boxes)
    this.h.set(this.goal)
    this.draw(0, true)
  }

  /** Where its windows are now; none leaves it a small round bubble where it was. */
  private aim(boxes: readonly Box[]) {
    const goal = roundOf(boxes)
    const floor = roundOf(boxes, CLEAR)
    if (goal && floor) {
      this.goal = goal
      this.floor = floor
      return
    }
    // A bubble whose last window has gone to another: a point at its middle, grown.
    const { x, y } = this.middle()
    for (let i = 0; i < N; i++) {
      const far = x * (COS[i] ?? 0) + y * (SIN[i] ?? 0)
      this.goal[i] = far + PAD
      this.floor[i] = Number.NEGATIVE_INFINITY
    }
  }

  /** The middle of what it reaches now. */
  private middle(): { x: number; y: number } {
    const at = (share: number) => this.h[Math.round(share * N) % N] ?? 0
    return { x: (at(0) - at(0.5)) / 2, y: (at(0.25) - at(0.75)) / 2 }
  }

  /** Moves the bubble on by `seconds` to time `t`, round `boxes` - its windows as each is
   *  drawn now. `still` puts it where it goes at once and leaves the breathing out:
   *  what reduced motion asks. The cuts of the last frame are let go of; `apart` makes
   *  this frame's. */
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
      // The exact step of a critically damped spring: never past where it goes.
      const off = (this.h[i] ?? 0) - goal
      const v = this.speed[i] ?? 0
      const lead = v + RATE * off
      this.h[i] = goal + (off + lead * dt) * fade
      this.speed[i] = (v - RATE * lead * dt) * fade
      const floor = this.floor[i] ?? 0
      if ((this.h[i] ?? 0) < floor) {
        this.h[i] = floor
        this.speed[i] = Math.max(0, this.speed[i] ?? 0)
      }
    }
    this.edges = []
    this.draw(t, still)
  }

  private t = 0
  private still = false

  /** The outline at `t`: its hull, breathing - each point moved out from the middle by
   *  the waves at its angle, a pixel or so - and cut where it meets another bubble. */
  private draw(t: number, still: boolean) {
    this.t = t
    this.still = still
    let points = even(hullOf(this.h))
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

  /** Cut along `edge` as well, where it meets another bubble (`apart`). */
  meet(edge: Edge) {
    this.edges.push(edge)
    this.draw(this.t, this.still)
  }

  /** How far out it reaches along direction `i`, as drawn before any cut. */
  reach(i: number): number {
    return this.h[((i % N) + N) % N] ?? 0
  }

  /** The outline as drawn: a closed polygon, which `pathOf` rounds. */
  points(): readonly Point[] {
    return this.outline
  }

  /** The outline as an SVG path: a closed curve through every point (Catmull-Rom, as
   *  cubic Béziers). */
  pathOf(): string {
    const r = (value: number) => Math.round(value * 10) / 10
    let d = ''
    for (const [index, [x0, y0, c1x, c1y, c2x, c2y, x1, y1]] of this.curves().entries()) {
      if (index === 0) d = `M${r(x0)} ${r(y0)}`
      d += `C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x1)} ${r(y1)}`
    }
    return d ? `${d}Z` : ''
  }

  /** Each stretch of the drawn curve: its two ends and two handles. */
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

  /** The top of the bubble over the middle of it, where its name goes. */
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

/** Two bubbles that would overlap, cut flat where they meet: along the line down the
 *  middle of the widest gap between their windows, each `SEAM` off it. Windows of the
 *  two that overlap themselves leave no gap to meet in, and the bubbles as they are. */
export function apart(
  one: Bubble,
  other: Bubble,
  ones: readonly Box[],
  others: readonly Box[],
): void {
  const near = reachOf(ones, 0)
  const far = reachOf(others, 0)
  if (!near || !far) return
  // The direction the gap between the two sets of windows is widest along.
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
  // Already clear of each other along it: nothing to cut.
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
