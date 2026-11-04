/** A space's cell on the overview's canvas: the membrane round its windows, never quite
 *  still (issue #331).
 *
 *  Emil, 2026-11-03: in All spaces each space sits in a bubble like a biological cell,
 *  its border moving gently and organically, and a window dragged towards it pushes it
 *  outward, following the pointer, until it plops across into the next cell. And
 *  2026-11-04: the movement only slight, just enough to feel alive; the shape round, not
 *  edgy; and the border always round every window of its cell, whatever is going on.
 *
 *  A soft body, kept small: a ring of points on rays out of the cell's middle, each
 *  sprung to where the membrane would rest on its ray - a superellipse round the windows,
 *  breathing a little, a few slow waves running round it - and pulled towards its
 *  neighbours, so a push spreads as a bulge rather than a spike.
 *
 *  **It never leaves a window out.** The springs are only how the membrane moves; where
 *  it may be is decided afresh every frame from the windows themselves, as they are drawn
 *  at that moment: on each ray, the membrane is never nearer the middle than the farthest
 *  point of any window between that ray's two neighbours, plus a margin (`floorOf`). So
 *  a window that is dragged, pushed, flying back or laid out anew is inside its cell on
 *  every frame, however the springs lag. Pure but for the clock handed in; the drawing
 *  is `pathOf`. */

import type { Box } from './layout'

/** Points round the ring: smooth at every size a cell is drawn at, and cheap. */
const POINTS = 96

/** How far the rounded shape stands off the box round the windows, before it is rounded. */
export const PAD = 26

/** How far, at least, the membrane stays off any window of its cell. */
export const CLEAR = 14

/** How round: 2 is an ellipse, higher is squarer; 4 would be the rounded shape, which reads
 *  as a box with its corners taken off. */
const ROUND = 3

/** How a point answers: quick enough to follow a hand, soft enough to settle after. */
const STIFF = 140
const DAMP = 16
/** How much a point is pulled to the middle of its two neighbours. */
const TENSION = 90

/** Breathing, and three slow waves round it: a pixel or so, so the cell is alive
 *  rather than wobbling. */
const BREATH = 0.9
const BREATH_RATE = 0.22
const WAVE = 0.7
const WAVES: readonly { lobes: number; rate: number; phase: number }[] = [
  { lobes: 2, rate: 0.09, phase: 0 },
  { lobes: 3, rate: -0.13, phase: 1.7 },
  { lobes: 5, rate: 0.17, phase: 4.1 },
]

/** How much further out, at most, a point is held than the next, by how far apart. */
const SLOPE = 0.6

/** How far along the membrane, in pixels, a push is felt on either side of it. */
const SPREAD = 90

/** The rounded shape round a box: its middle and its two half-axes, wide enough that the box,
 *  padded, is inside it - its corners on the curve. */
export function shapeOf(box: Box) {
  const grow = 2 ** (1 / ROUND)
  return {
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    a: (box.w / 2 + PAD) * grow,
    b: (box.h / 2 + PAD) * grow,
  }
}

/** How far out of `from` along the ray at `angle` the box reaches, or -1 where the ray
 *  misses it. */
function exitOf(from: { x: number; y: number }, angle: number, box: Box): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let lo = Number.NEGATIVE_INFINITY
  let hi = Number.POSITIVE_INFINITY
  for (const [o, d, min, max] of [
    [from.x, dx, box.x, box.x + box.w],
    [from.y, dy, box.y, box.y + box.h],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return -1
      continue
    }
    const t1 = (min - o) / d
    const t2 = (max - o) / d
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  return hi >= Math.max(lo, 0) ? hi : -1
}

const TAU = 2 * Math.PI

/** The rays the points stand on, for a shape: spread along its curve, not evenly by angle,
 *  so its rounded corners have as many points as its long sides and are drawn as curves;
 *  each ray's angle, the shape's distance out along it, and how far along the curve each
 *  point is from the first. */
function raysOf(shape: ReturnType<typeof shapeOf>) {
  const angles = new Float64Array(POINTS)
  const radii = new Float64Array(POINTS)
  const arcs = new Float64Array(POINTS + 1)
  const bend = 2 / ROUND
  let lastX = 0
  let lastY = 0
  for (let i = 0; i <= POINTS; i++) {
    const t = (i / POINTS) * TAU - Math.PI / 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = Math.sign(c) * Math.abs(c) ** bend * shape.a
    const y = Math.sign(s) * Math.abs(s) ** bend * shape.b
    if (i > 0) arcs[i] = (arcs[i - 1] ?? 0) + Math.hypot(x - lastX, y - lastY)
    lastX = x
    lastY = y
    if (i === POINTS) break
    angles[i] = Math.atan2(y, x)
    radii[i] = Math.hypot(x, y)
  }
  return { angles, radii, arcs }
}

/** Whether `angle` is between `from` and `to`, going the short way round from one to the
 *  other through increasing angles. */
function between(angle: number, from: number, to: number): boolean {
  const span = (((to - from) % TAU) + TAU) % TAU
  const off = (((angle - from) % TAU) + TAU) % TAU
  return off <= span
}

/** How near the middle each point may come: the farthest any window, grown by `CLEAR`,
 *  reaches between the rays either side of that point's - at those two rays, at its own
 *  and at every corner in between, which is where a box's farthest point in a wedge can
 *  be. Each stretch of membrane between two points is then outside every window in it. */
function floorsOf(
  centre: { x: number; y: number },
  boxes: readonly Box[],
  angles: Float64Array,
): Float64Array {
  const exits = new Float64Array(POINTS)
  const floors = new Float64Array(POINTS)
  const ray = (i: number) => angles[((i % POINTS) + POINTS) % POINTS] ?? 0
  for (const one of boxes) {
    const box = { x: one.x - CLEAR, y: one.y - CLEAR, w: one.w + 2 * CLEAR, h: one.h + 2 * CLEAR }
    for (let i = 0; i < POINTS; i++) exits[i] = exitOf(centre, ray(i), box)
    for (let i = 0; i < POINTS; i++) {
      const far = Math.max(
        exits[(i + POINTS - 1) % POINTS] ?? 0,
        exits[i] ?? 0,
        exits[(i + 1) % POINTS] ?? 0,
      )
      floors[i] = Math.max(floors[i] ?? 0, far)
    }
    for (const [x, y] of [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x, box.y + box.h],
      [box.x + box.w, box.y + box.h],
    ] as const) {
      const at = Math.atan2(y - centre.y, x - centre.x)
      const far = Math.hypot(x - centre.x, y - centre.y)
      for (let i = 0; i < POINTS; i++) {
        if (between(at, ray(i - 1), ray(i + 1))) floors[i] = Math.max(floors[i] ?? 0, far)
      }
    }
  }
  return floors
}

export class Membrane {
  /** Each point's distance out from the rounded shape along its ray, and how fast that is
   *  changing. */
  private readonly off = new Float64Array(POINTS)
  private readonly speed = new Float64Array(POINTS)
  /** Where each point is, as last stepped; `pathOf` draws them. */
  readonly xs = new Float64Array(POINTS)
  readonly ys = new Float64Array(POINTS)

  constructor(public box: Box) {
    this.place(this.restsOf(0, [], true), true)
  }

  /** Moves the membrane on by `seconds` to time `t`, round its `box`, and round every
   *  window of `inside` as it is drawn now, however far it is out of the box. `still`
   *  puts every point where it rests at once and leaves the breathing out: what reduced
   *  motion asks. */
  step(seconds: number, t: number, inside: readonly Box[], still = false) {
    if (still) {
      this.place(this.restsOf(t, inside, true), true)
      return
    }
    const now = this.restsOf(t, inside)
    const { rests } = now
    let left = Math.min(seconds, 0.05)
    while (left > 0) {
      const dt = Math.min(left, 1 / 240)
      for (let i = 0; i < POINTS; i++) {
        const before = this.off[(i + POINTS - 1) % POINTS] ?? 0
        const after = this.off[(i + 1) % POINTS] ?? 0
        const here = this.off[i] ?? 0
        const pull =
          -STIFF * (here - (rests[i] ?? 0)) +
          TENSION * ((before + after) / 2 - here) -
          DAMP * (this.speed[i] ?? 0)
        this.speed[i] = (this.speed[i] ?? 0) + pull * dt
      }
      for (let i = 0; i < POINTS; i++) this.off[i] = (this.off[i] ?? 0) + (this.speed[i] ?? 0) * dt
      left -= dt
    }
    this.place(now, false)
  }

  /** A shove from inside or out where a window just left or arrived: the plop. */
  shove(at: { x: number; y: number }, strength: number) {
    for (let i = 0; i < POINTS; i++) {
      const d = Math.hypot((this.xs[i] ?? 0) - at.x, (this.ys[i] ?? 0) - at.y)
      if (d < SPREAD * 2) this.speed[i] = (this.speed[i] ?? 0) + strength * (1 - d / (SPREAD * 2))
    }
  }

  /** Where each point rests at `t`, and how near the middle it may be: the rounded shape,
   *  breathing, the waves on it, and pushed out softly round every window that reaches
   *  past it. */
  private restsOf(t: number, inside: readonly Box[], calm = false) {
    const shape = shapeOf(this.box)
    const centre = { x: shape.cx, y: shape.cy }
    const rests = new Float64Array(POINTS)
    const rays = this.raysFor(shape)
    const { radii, arcs, angles } = rays
    const floors = floorsOf(centre, inside, angles)
    for (let i = 0; i < POINTS; i++) floors[i] = (floors[i] ?? 0) - (radii[i] ?? 0)
    // No steeper than `SLOPE` from one point to the next, so the curve drawn through
    // them, which swings past a sharp step, never swings in across a window.
    // Twice round each way, so a need anywhere reaches all the way round the ring.
    const total = arcs[POINTS] ?? 1
    const gap = (i: number, j: number) => {
      const apart = Math.abs((arcs[i] ?? 0) - (arcs[j] ?? 0))
      return Math.min(apart, total - apart)
    }
    for (let pass = 0; pass < 2 * POINTS; pass++) {
      const i = pass % POINTS
      const before = (i + POINTS - 1) % POINTS
      floors[i] = Math.max(floors[i] ?? 0, (floors[before] ?? 0) - SLOPE * gap(i, before))
    }
    for (let pass = 2 * POINTS - 1; pass >= 0; pass--) {
      const i = pass % POINTS
      const after = (i + 1) % POINTS
      floors[i] = Math.max(floors[i] ?? 0, (floors[after] ?? 0) - SLOPE * gap(i, after))
    }
    const pushing: number[] = []
    for (let j = 0; j < POINTS; j++) if ((floors[j] ?? 0) > 0) pushing.push(j)
    for (let i = 0; i < POINTS; i++) {
      const share = i / POINTS
      let rest = calm ? 0 : BREATH * Math.sin(t * BREATH_RATE * TAU)
      if (!calm) {
        for (const wave of WAVES)
          rest += WAVE * Math.sin(share * wave.lobes * TAU + t * wave.rate * TAU + wave.phase)
      }
      // A window past the rounded shape is a bulge, felt a little way either side of it.
      for (const j of pushing) {
        const need = floors[j] ?? 0
        const apart = gap(i, j)
        if (apart >= SPREAD) continue
        rest = Math.max(rest, need * (0.5 + 0.5 * Math.cos((apart / SPREAD) * Math.PI)))
      }
      rests[i] = rest
    }
    return { rests, floors, shape, radii, angles }
  }

  /** The rounded shape's distance out along every ray, kept while its size is the same. */
  private rays = { a: -1, b: -1, of: raysOf({ cx: 0, cy: 0, a: 1, b: 1 }) }

  private raysFor(shape: ReturnType<typeof shapeOf>): ReturnType<typeof raysOf> {
    const kept = this.rays
    if (kept.a !== shape.a || kept.b !== shape.b) {
      kept.of = raysOf(shape)
      kept.a = shape.a
      kept.b = shape.b
    }
    return kept.of
  }

  private place(
    { rests, floors, shape, radii, angles }: ReturnType<Membrane['restsOf']>,
    settle: boolean,
  ) {
    for (let i = 0; i < POINTS; i++) {
      if (settle) {
        this.off[i] = rests[i] ?? 0
        this.speed[i] = 0
      }
      // Never in past a window: where the springs would have it so, it stops at the
      // window and loses the speed that carried it there.
      const floor = floors[i] ?? 0
      if ((this.off[i] ?? 0) < floor) {
        this.off[i] = floor
        this.speed[i] = Math.max(0, this.speed[i] ?? 0)
      }
      const angle = angles[i] ?? 0
      const r = (radii[i] ?? 0) + (this.off[i] ?? 0)
      this.xs[i] = shape.cx + Math.cos(angle) * r
      this.ys[i] = shape.cy + Math.sin(angle) * r
    }
  }

  /** The membrane as an SVG path: a closed curve through every point (Catmull-Rom, as
   *  cubic Béziers). */
  pathOf(): string {
    const r = (value: number) => Math.round(value * 10) / 10
    let d = ''
    for (const [index, [x0, y0, c1x, c1y, c2x, c2y, x1, y1]] of this.curves().entries()) {
      if (index === 0) d = `M${r(x0)} ${r(y0)}`
      d += `C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x1)} ${r(y1)}`
    }
    return `${d}Z`
  }

  /** Each stretch of the drawn curve: its two ends and two handles. */
  curves(): [number, number, number, number, number, number, number, number][] {
    const n = POINTS
    const at = (i: number) => {
      const k = ((i % n) + n) % n
      return [this.xs[k] ?? 0, this.ys[k] ?? 0] as const
    }
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

  /** The top of the membrane over the middle of its box, where a cell's name goes. */
  crown(): { x: number; y: number } {
    const shape = shapeOf(this.box)
    return { x: shape.cx, y: shape.cy - shape.b }
  }
}
