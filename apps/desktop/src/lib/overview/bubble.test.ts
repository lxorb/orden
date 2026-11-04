import { expect, test } from 'vitest'
import { apart, Bubble, CLEAR, PAD } from './bubble'
import type { Box } from './layout'

/** The curve as drawn, sampled finely: every Bézier of the path at many points. */
function outline(one: Bubble): [number, number][] {
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

function insideOf(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] ?? [0, 0]
    const [xj, yj] = poly[j] ?? [0, 0]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether every window is inside the drawn bubble, by `by` at least: its corners and
 *  points along its edges. */
function encloses(one: Bubble, windows: readonly Box[], by = CLEAR / 2): boolean {
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

/** How far past `box`, at the most, the drawn bubble reaches. */
function farthest(one: Bubble, box: Box): number {
  let most = 0
  for (const [x, y] of outline(one)) {
    const dx = Math.max(box.x - x, 0, x - (box.x + box.w))
    const dy = Math.max(box.y - y, 0, y - (box.y + box.h))
    most = Math.max(most, Math.hypot(dx, dy))
  }
  return most
}

/** How far past a window, at the most, its own round shape reaches: a fifth of its
 *  half-size, past `PAD`, at the middle of its long sides. */
const reachPast = (box: Box) => 0.2 * (Math.max(box.w, box.h) / 2 + PAD) + PAD + 2

const run = (one: Bubble, windows: () => readonly Box[], frames: number, from = 0) => {
  for (let frame = 0; frame < frames; frame++) one.step(1 / 60, (from + frame) / 60, windows())
}

test('round one window it is that window grown a little, and nowhere further', () => {
  // Emil's Orga: one window at the bottom left of a space's room, and a blob over all of it.
  const only = { x: 40, y: 900, w: 360, h: 260 }
  const one = new Bubble([only])
  run(one, () => [only], 240)
  expect(farthest(one, only)).toBeLessThan(reachPast(only))
  expect(encloses(one, [only], PAD / 2)).toBe(true)
  // Round at every corner: the curve never turns sharply from one stretch to the next.
  const curve = outline(one)
  let sharpest = 0
  for (let i = 0; i < curve.length; i++) {
    const [ax, ay] = curve[i] ?? [0, 0]
    const [bx, by] = curve[(i + 1) % curve.length] ?? [0, 0]
    const [cx, cy] = curve[(i + 2) % curve.length] ?? [0, 0]
    if (Math.hypot(cx - bx, cy - by) < 1e-6 || Math.hypot(bx - ax, by - ay) < 1e-6) continue
    const turn = Math.atan2(cy - by, cx - bx) - Math.atan2(by - ay, bx - ax)
    sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))))
  }
  expect(sharpest).toBeLessThan((8 * Math.PI) / 180)
})

test('round two windows far apart it is their hull, never wider where there are none', () => {
  const left = { x: 0, y: 0, w: 300, h: 200 }
  const right = { x: 900, y: 0, w: 300, h: 200 }
  const one = new Bubble([left, right])
  run(one, () => [left, right], 120)
  expect(farthest(one, { x: 0, y: 0, w: 1200, h: 200 })).toBeLessThan(reachPast(left))
})

test('its one window dragged away takes the bubble and its name with it', () => {
  const was = { x: 0, y: 0, w: 300, h: 200 }
  const one = new Bubble([was])
  const crownBefore = one.crown()
  const now = { ...was }
  for (let frame = 0; frame < 120; frame++) {
    now.x = was.x + frame * 12
    now.y = was.y + frame * 4
    one.step(1 / 60, frame / 60, [now])
    expect(encloses(one, [now])).toBe(true)
  }
  run(one, () => [now], 60, 120)
  expect(farthest(one, now)).toBeLessThan(reachPast(now))
  // Nothing of it is left where the window was.
  expect(insideOf(outline(one), was.x + was.w / 2, was.y + was.h / 2)).toBe(false)
  const crown = one.crown()
  expect(crown.x - crownBefore.x).toBeCloseTo(now.x - was.x, -1)
  expect(now.y - crown.y).toBeGreaterThan(PAD)
  expect(now.y - crown.y).toBeLessThan(reachPast(now))
})

test('every window is inside it on every frame: dragged, thrown, arriving and leaving', () => {
  // A seeded walk, so a failure is the same failure again.
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let round = 0; round < 24; round++) {
    const windows: Box[] = Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({
      x: random() * 900 - 300,
      y: random() * 700 - 200,
      w: 120 + random() * 260,
      h: 80 + random() * 160,
    }))
    const one = new Bubble(windows.slice(0, 1))
    for (let frame = 0; frame < 90; frame++) {
      const count = 1 + (Math.floor(frame / 15 + round) % windows.length)
      const shown = windows
        .slice(0, count)
        .map((w, i) => ({ ...w, x: w.x + Math.sin(frame / 7 + round + i) * 140 }))
      one.step(1 / 60, frame / 60, shown)
      if (frame % 3 === 0) expect(encloses(one, shown)).toBe(true)
    }
  }
})

test('two bubbles that would overlap meet along a line between them, and never overlap', () => {
  for (const gap of [70, 40, 20, 8]) {
    const ones = [{ x: 0, y: 0, w: 300, h: 200 }]
    const others = [
      { x: 300 + gap, y: 60, w: 300, h: 200 },
      { x: 300 + gap, y: 300, w: 200, h: 120 },
    ]
    const one = new Bubble(ones)
    const other = new Bubble(others)
    for (let frame = 0; frame < 60; frame++) {
      one.step(1 / 60, frame / 60, ones)
      other.step(1 / 60, frame / 60, others)
      apart(one, other, ones, others)
    }
    const a = outline(one)
    const b = outline(other)
    expect(a.some(([x, y]) => insideOf(b, x, y))).toBe(false)
    expect(b.some(([x, y]) => insideOf(a, x, y))).toBe(false)
    expect(encloses(one, ones, Math.min(CLEAR / 2, gap / 2 - 5))).toBe(true)
    expect(encloses(other, others, Math.min(CLEAR / 2, gap / 2 - 5))).toBe(true)
  }
})

test('it moves only slightly: a pixel or two, with nothing moving it', () => {
  const box = { x: 0, y: 0, w: 400, h: 300 }
  const one = new Bubble([box])
  const paths = new Set<string>()
  const rights: number[] = []
  for (let frame = 0; frame < 600; frame++) {
    one.step(1 / 60, frame / 60, [box])
    if (frame % 60 === 0) paths.add(one.pathOf())
    rights.push(Math.max(...one.points().map(([x]) => x)))
  }
  expect(paths.size).toBeGreaterThan(5)
  const spread = Math.max(...rights) - Math.min(...rights)
  expect(spread).toBeGreaterThan(0.2)
  expect(spread).toBeLessThan(5)
})

test('asked for less movement it stands still, and follows its windows at once', () => {
  const box = { x: 0, y: 0, w: 400, h: 300 }
  const one = new Bubble([box])
  one.step(1 / 60, 0.1, [box], true)
  const first = one.pathOf()
  one.step(1 / 60, 0.9, [box], true)
  expect(one.pathOf()).toBe(first)
  expect(first).toMatch(/^M[-\d.]+ [-\d.]+C/)
  const moved = { ...box, x: 2000 }
  one.step(1 / 60, 1, [moved], true)
  expect(farthest(one, moved)).toBeLessThan(reachPast(moved))
  expect(insideOf(outline(one), 200, 150)).toBe(false)
})
