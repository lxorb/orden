import { expect, test } from 'vitest'
import type { Box } from './layout'
import { packed } from './pack'

const GAP = 40

const apart = (a: Box, b: Box) =>
  a.x + a.w + GAP <= b.x + 0.5 ||
  b.x + b.w + GAP <= a.x + 0.5 ||
  a.y + a.h + GAP <= b.y + 0.5 ||
  b.y + b.h + GAP <= a.y + 0.5

function around(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((one) => one.x))
  const y = Math.min(...boxes.map((one) => one.y))
  const right = Math.max(...boxes.map((one) => one.x + one.w))
  const bottom = Math.max(...boxes.map((one) => one.y + one.h))
  return { x, y, w: right - x, h: bottom - y }
}

const sizes = [
  { key: 'a', w: 900, h: 600 },
  { key: 'b', w: 500, h: 400 },
  { key: 'c', w: 700, h: 300 },
  { key: 'd', w: 400, h: 400 },
  { key: 'e', w: 800, h: 500 },
  { key: 'f', w: 300, h: 250 },
  { key: 'g', w: 600, h: 600 },
]

test('the first goes on the middle, and none comes nearer another than the gap', () => {
  const out = packed(sizes, GAP)
  expect(out.a).toEqual({ x: -450, y: -300, w: 900, h: 600 })
  const boxes = Object.values(out)
  expect(boxes).toHaveLength(sizes.length)
  for (const one of boxes)
    for (const other of boxes) if (one !== other) expect(apart(one, other)).toBe(true)
})

test('they pack round the middle, not in a row: a squarish heap, mostly filled', () => {
  // Emil, round 4: Tidy up laid them out in a straight line.
  const boxes = Object.values(packed(sizes, GAP))
  const all = around(boxes)
  const wide = Math.max(all.w / all.h, all.h / all.w)
  expect(wide).toBeLessThan(2)
  const area = boxes.reduce((sum, one) => sum + one.w * one.h, 0)
  expect(area / (all.w * all.h)).toBeGreaterThan(0.5)
  // Round the middle: it is inside the heap, nearer its middle than its edge.
  expect(Math.abs(all.x + all.w / 2)).toBeLessThan(all.w / 4)
  expect(Math.abs(all.y + all.h / 2)).toBeLessThan(all.h / 4)
})

test('each goes in the free place nearest the middle: on a wide screen, two go side by side', () => {
  const out = packed(
    [
      { key: 'a', w: 400, h: 300 },
      { key: 'b', w: 400, h: 300 },
    ],
    GAP,
    [],
    { x: 0, y: 0 },
    16 / 10,
  )
  // Beside the first and level with it, rather than anywhere further.
  expect(out.b?.y).toBe(-150)
  expect(Math.abs(out.b?.x ?? 0)).toBe(200 + GAP)
})

test('what is taken already stays, and the new ones pack round it', () => {
  const taken = [{ x: -500, y: -300, w: 1000, h: 600 }]
  const out = packed([{ key: 'n', w: 300, h: 200 }], GAP, taken, { x: 0, y: 0 })
  const box = out.n
  expect(box).toBeDefined()
  if (!box) return
  expect(apart(box, taken[0] as Box)).toBe(true)
  // Right against it, the gap away, not somewhere off in the distance.
  const taken0 = taken[0] as Box
  const gapX = Math.max(box.x - (taken0.x + taken0.w), taken0.x - (box.x + box.w))
  const gapY = Math.max(box.y - (taken0.y + taken0.h), taken0.y - (box.y + box.h))
  expect(Math.max(gapX, gapY)).toBeCloseTo(GAP)
})

test('the same spaces pack the same way every time, at any zoom: nothing here knows one', () => {
  expect(packed(sizes, GAP)).toEqual(packed(sizes, GAP))
})
