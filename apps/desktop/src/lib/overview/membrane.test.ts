import { expect, test } from 'vitest'
import type { Box } from './layout'
import { CLEAR, Membrane, PAD, shapeOf } from './membrane'

const box = { x: 0, y: 0, w: 400, h: 300 }

/** The farthest the membrane reaches to the right. */
const right = (one: Membrane) => Math.max(...one.xs)

/** The curve as drawn, sampled finely: every Bézier of the path at many points. */
function outline(one: Membrane): [number, number][] {
  const out: [number, number][] = []
  for (const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] of one.curves()) {
    for (let k = 0; k < 8; k++) {
      const t = k / 8
      const u = 1 - t
      out.push([
        u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
        u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
      ])
    }
  }
  return out
}

function insideOf(poly: [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] ?? [0, 0]
    const [xj, yj] = poly[j] ?? [0, 0]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether every window is inside the drawn membrane, by a few pixels at least: its
 *  corners and points along its edges. */
function encloses(one: Membrane, windows: readonly Box[], by = CLEAR / 2): boolean {
  const poly = outline(one)
  return windows.every((w) => {
    for (let k = 0; k <= 8; k++) {
      const f = k / 8
      const points = [
        [w.x - by + f * (w.w + 2 * by), w.y - by],
        [w.x - by + f * (w.w + 2 * by), w.y + w.h + by],
        [w.x - by, w.y - by + f * (w.h + 2 * by)],
        [w.x + w.w + by, w.y - by + f * (w.h + 2 * by)],
      ] as const
      if (!points.every(([x, y]) => insideOf(poly, x, y))) return false
    }
    return true
  })
}

test('at rest it is a round shape standing off the windows, and is never quite still', () => {
  const one = new Membrane(box)
  const shape = shapeOf(box)
  expect(right(one)).toBeCloseTo(shape.cx + shape.a, 0)
  expect(encloses(one, [box], PAD / 2)).toBe(true)
  // Round: from one stretch of the drawn curve to the next it never turns sharply, at
  // its corners or anywhere else, whatever the cell's shape.
  for (const shaped of [box, { x: 0, y: 0, w: 1200, h: 700 }, { x: 0, y: 0, w: 300, h: 900 }]) {
    const curve = outline(new Membrane(shaped))
    let sharpest = 0
    for (let i = 0; i < curve.length; i++) {
      const [ax, ay] = curve[i] ?? [0, 0]
      const [bx, by] = curve[(i + 1) % curve.length] ?? [0, 0]
      const [cx, cy] = curve[(i + 2) % curve.length] ?? [0, 0]
      const turn = Math.atan2(cy - by, cx - bx) - Math.atan2(by - ay, bx - ax)
      sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))))
    }
    expect(sharpest).toBeLessThan((4 * Math.PI) / 180)
  }
  one.step(1 / 60, 0.2, [box])
  const first = one.pathOf()
  for (let frame = 0; frame < 30; frame++) one.step(1 / 60, 0.2 + frame / 60, [box])
  expect(one.pathOf()).not.toBe(first)
  expect(first).toMatch(/^M[-\d.]+ [-\d.]+C/)
})

test('it moves only slightly: a few pixels at most, with nothing pushing it', () => {
  const one = new Membrane(box)
  const rest = [...one.xs]
  let most = 0
  for (let frame = 0; frame < 600; frame++) {
    one.step(1 / 60, frame / 60, [box])
    for (let i = 0; i < rest.length; i++)
      most = Math.max(most, Math.abs((one.xs[i] ?? 0) - (rest[i] ?? 0)))
  }
  expect(most).toBeGreaterThan(0.2)
  expect(most).toBeLessThan(4)
})

test('a window held past its edge pushes it out round the window, and it springs back', () => {
  const one = new Membrane(box)
  const held = { x: 380, y: 100, w: 200, h: 100 }
  for (let frame = 0; frame < 120; frame++) one.step(1 / 60, frame / 60, [box, held])
  expect(right(one)).toBeGreaterThan(held.x + held.w + CLEAR - 1)
  for (let frame = 0; frame < 240; frame++) one.step(1 / 60, 2 + frame / 60, [box])
  expect(right(one)).toBeLessThan(shapeOf(box).cx + shapeOf(box).a + 6)
})

test('every window is inside it on every frame: dragged, pushed, thrown and shoved', () => {
  // A seeded walk, so a failure is the same failure again.
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let run = 0; run < 24; run++) {
    const windows: Box[] = Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({
      x: random() * 900 - 300,
      y: random() * 700 - 200,
      w: 120 + random() * 260,
      h: 80 + random() * 160,
    }))
    const one = new Membrane({ x: 0, y: 0, w: 300, h: 200 })
    for (let frame = 0; frame < 90; frame++) {
      // The box the membrane rests round lags the windows, as a spring would.
      const shown = windows.map((w) => ({ ...w, x: w.x + Math.sin(frame / 7 + run) * 140 }))
      if (frame % 20 === 0) one.shove({ x: shown[0]?.x ?? 0, y: shown[0]?.y ?? 0 }, -400)
      one.box = { x: frame * 3, y: 0, w: 300, h: 200 }
      one.step(1 / 60, frame / 60, shown)
      if (frame % 3 === 0) expect(encloses(one, shown)).toBe(true)
    }
  }
})

test('asked for less movement it stands still, and still makes room at once', () => {
  const one = new Membrane(box)
  one.step(1 / 60, 0.1, [box], true)
  const first = one.pathOf()
  one.step(1 / 60, 0.9, [box], true)
  expect(one.pathOf()).toBe(first)
  const held = { x: 380, y: 100, w: 200, h: 100 }
  one.step(1 / 60, 1, [box, held], true)
  expect(encloses(one, [box, held])).toBe(true)
})
