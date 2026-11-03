/** A space's cell on the overview's canvas: the membrane round its windows, never quite
 *  still (issue #331).
 *
 *  Emil, 2026-11-03: in All spaces each space sits in a bubble like a biological cell,
 *  its border moving gently and organically - breathing, a slight wobble, soft
 *  deformation - and a window dragged towards it pushes it outward, following the
 *  pointer, until it plops across into the next cell.
 *
 *  A soft body, kept small: a ring of points round a rounded box, each sprung to where the
 *  membrane would rest - the box, breathing in and out, a few slow waves running round it
 *  - and pulled towards its neighbours, so a push spreads as a bulge rather than a spike.
 *  A window held against it moves the resting place of the points it is near outward, as
 *  far as it reaches, so the membrane stretches round the window and springs back when it
 *  goes. Pure but for the clock handed in; the drawing is `pathOf`. */

import type { Box } from './layout'

/** Points round the ring: smooth at every size a cell is drawn at, and cheap. */
const POINTS = 56

/** How far the membrane stands off the windows inside it. */
export const PAD = 36

/** How a point answers: quick enough to follow a hand, soft enough to wobble after. */
const STIFF = 140
const DAMP = 14
/** How much a point is pulled to the middle of its two neighbours. */
const TENSION = 90

/** Breathing: how far, and how slowly. Waves: how far, and three slow ones round it. */
const BREATH = 3
const BREATH_RATE = 0.9
const WAVE = 2.2
const WAVES: readonly { lobes: number; rate: number; phase: number }[] = [
  { lobes: 2, rate: 0.37, phase: 0 },
  { lobes: 3, rate: -0.53, phase: 1.7 },
  { lobes: 5, rate: 0.71, phase: 4.1 },
]

/** How far along the membrane a push is felt on either side of the window. */
const SPREAD = 90

/** Where on a rounded box, `share` of the way round it, a point lies, and which way is
 *  out there. The corners are quarter circles of `radius`. */
export function ringPoint(box: Box, radius: number, share: number) {
  const r = Math.max(0, Math.min(radius, box.w / 2, box.h / 2))
  const straightW = box.w - 2 * r
  const straightH = box.h - 2 * r
  const arc = (Math.PI / 2) * r
  const edges = [straightW, arc, straightH, arc, straightW, arc, straightH, arc]
  const total = edges.reduce((sum, one) => sum + one, 0) || 1
  let along = (((share % 1) + 1) % 1) * total

  // Top edge left to right, then the corners and edges clockwise.
  const corners = [
    { cx: box.x + box.w - r, cy: box.y + r, from: -Math.PI / 2 },
    { cx: box.x + box.w - r, cy: box.y + box.h - r, from: 0 },
    { cx: box.x + r, cy: box.y + box.h - r, from: Math.PI / 2 },
    { cx: box.x + r, cy: box.y + r, from: Math.PI },
  ]
  const straights = [
    { x: box.x + r, y: box.y, dx: 1, dy: 0, nx: 0, ny: -1 },
    { x: box.x + box.w, y: box.y + r, dx: 0, dy: 1, nx: 1, ny: 0 },
    { x: box.x + box.w - r, y: box.y + box.h, dx: -1, dy: 0, nx: 0, ny: 1 },
    { x: box.x, y: box.y + box.h - r, dx: 0, dy: -1, nx: -1, ny: 0 },
  ]
  for (let index = 0; index < edges.length; index++) {
    const length = edges[index] ?? 0
    if (along <= length || index === edges.length - 1) {
      const side = index >> 1
      if (index % 2 === 0) {
        const edge = straights[side]
        if (!edge) break
        return {
          x: edge.x + edge.dx * along,
          y: edge.y + edge.dy * along,
          nx: edge.nx,
          ny: edge.ny,
        }
      }
      const corner = corners[side]
      if (!corner) break
      const angle = corner.from + (r > 0 ? along / r : 0)
      const nx = Math.cos(angle)
      const ny = Math.sin(angle)
      return { x: corner.cx + nx * r, y: corner.cy + ny * r, nx, ny }
    }
    along -= length
  }
  return { x: box.x, y: box.y, nx: 0, ny: -1 }
}

/** How far a window `pushed` reaches out past the membrane's resting point at `p`, along
 *  its outward normal, faded by how far along the membrane it is from the point. */
export function reach(p: { x: number; y: number; nx: number; ny: number }, pushed: Box): number {
  const corners = [
    [pushed.x, pushed.y],
    [pushed.x + pushed.w, pushed.y],
    [pushed.x, pushed.y + pushed.h],
    [pushed.x + pushed.w, pushed.y + pushed.h],
  ] as const
  let out = Number.NEGATIVE_INFINITY
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const [x, y] of corners) {
    const dx = x - p.x
    const dy = y - p.y
    out = Math.max(out, dx * p.nx + dy * p.ny)
    // Along the membrane: the tangent is the normal turned a quarter.
    const along = dx * -p.ny + dy * p.nx
    lo = Math.min(lo, along)
    hi = Math.max(hi, along)
  }
  if (out <= -PAD) return 0
  // Zero inside the window's span along the membrane, growing either side of it.
  const off = lo > 0 ? lo : hi < 0 ? -hi : 0
  const fade = off >= SPREAD ? 0 : 0.5 + 0.5 * Math.cos((off / SPREAD) * Math.PI)
  return Math.max(0, out + PAD) * fade
}

export class Membrane {
  /** Each point's distance out from the box, and how fast that is changing. */
  private readonly off = new Float64Array(POINTS)
  private readonly speed = new Float64Array(POINTS)
  /** Where each point is, as last stepped; `pathOf` draws them. */
  readonly xs = new Float64Array(POINTS)
  readonly ys = new Float64Array(POINTS)

  constructor(public box: Box) {
    this.place(0, [], true)
  }

  /** Moves the membrane on by `seconds` to time `t`, round its `box`, stretched round
   *  every window `pushed`. `still` puts every point where it rests at once and leaves
   *  the breathing out: what reduced motion asks. */
  step(seconds: number, t: number, pushed: readonly Box[], still = false) {
    if (still) {
      this.place(t, pushed, true)
      return
    }
    const rests = this.rests(t, pushed)
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
    this.place(t, pushed, false)
  }

  /** A shove from inside or out where a window just left or arrived: the plop. */
  shove(at: { x: number; y: number }, strength: number) {
    for (let i = 0; i < POINTS; i++) {
      const d = Math.hypot((this.xs[i] ?? 0) - at.x, (this.ys[i] ?? 0) - at.y)
      if (d < SPREAD * 2) this.speed[i] = (this.speed[i] ?? 0) + strength * (1 - d / (SPREAD * 2))
    }
  }

  /** Where each point rests at `t`: the padded box, breathing, the waves on it, pushed
   *  out by every window against it. */
  private rests(t: number, pushed: readonly Box[], calm = false): Float64Array {
    const out = new Float64Array(POINTS)
    const padded = this.padded()
    for (let i = 0; i < POINTS; i++) {
      const share = i / POINTS
      const p = ringPoint(padded, PAD, share)
      let rest = calm ? 0 : BREATH * Math.sin(t * BREATH_RATE * 2 * Math.PI)
      if (!calm) {
        for (const wave of WAVES) {
          rest +=
            WAVE *
            Math.sin(share * wave.lobes * 2 * Math.PI + t * wave.rate * 2 * Math.PI + wave.phase)
        }
      }
      for (const box of pushed) rest = Math.max(rest, reach(p, box))
      out[i] = rest
    }
    return out
  }

  private padded(): Box {
    return {
      x: this.box.x - PAD,
      y: this.box.y - PAD,
      w: this.box.w + 2 * PAD,
      h: this.box.h + 2 * PAD,
    }
  }

  private place(t: number, pushed: readonly Box[], settle: boolean) {
    const padded = this.padded()
    const rests = settle ? this.rests(t, pushed, true) : null
    for (let i = 0; i < POINTS; i++) {
      if (rests) {
        this.off[i] = rests[i] ?? 0
        this.speed[i] = 0
      }
      const p = ringPoint(padded, PAD, i / POINTS)
      const off = this.off[i] ?? 0
      this.xs[i] = p.x + p.nx * off
      this.ys[i] = p.y + p.ny * off
    }
  }

  /** The membrane as an SVG path: a closed curve through every point (Catmull-Rom, as
   *  cubic Béziers). */
  pathOf(): string {
    const n = POINTS
    const at = (i: number) => {
      const k = ((i % n) + n) % n
      return [this.xs[k] ?? 0, this.ys[k] ?? 0] as const
    }
    const r = (value: number) => Math.round(value * 10) / 10
    const [x0, y0] = at(0)
    let d = `M${r(x0)} ${r(y0)}`
    for (let i = 0; i < n; i++) {
      const [ax, ay] = at(i - 1)
      const [bx, by] = at(i)
      const [cx, cy] = at(i + 1)
      const [ex, ey] = at(i + 2)
      d += `C${r(bx + (cx - ax) / 6)} ${r(by + (cy - ay) / 6)} ${r(cx - (ex - bx) / 6)} ${r(cy - (ey - by) / 6)} ${r(cx)} ${r(cy)}`
    }
    return `${d}Z`
  }
}
