import { expect, test } from 'vitest'
import type { Box } from './layout'
import { boundsOf, gapOf, moved, outlineOf, type Outline } from './outline'
import { meets, packed, pushedAside, type Shift } from './pack'

const GAP = 4

const shapeOf = (box: Box): Outline => {
  const outline = outlineOf([box])
  if (!outline) throw new Error('no outline')
  return outline
}

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
].map(({ key, w, h }) => ({ key, outline: shapeOf({ x: 0, y: 0, w, h }) }))

function placedOf(out: Record<string, Shift>): Outline[] {
  return sizes.map(({ key, outline }) => {
    const shift = out[key] ?? { x: 0, y: 0 }
    return moved(outline, shift.x, shift.y)
  })
}

test('the first goes on the middle, and no outline comes nearer another than the gap', () => {
  const out = packed(sizes, GAP)
  expect(out.a?.x).toBeCloseTo(-450)
  expect(out.a?.y).toBeCloseTo(-300)
  const all = placedOf(out)
  for (const one of all)
    for (const other of all)
      if (one !== other) expect(gapOf(one, other)).toBeGreaterThan(GAP - 0.05)
})

test('they pack round the middle, not in a row: a squarish heap, mostly filled', () => {
  const boxes = placedOf(packed(sizes, GAP)).map(boundsOf)
  const all = around(boxes)
  const wide = Math.max(all.w / all.h, all.h / all.w)
  expect(wide).toBeLessThan(2)
  const area = boxes.reduce((sum, one) => sum + one.w * one.h, 0)
  expect(area / (all.w * all.h)).toBeGreaterThan(0.5)
  expect(Math.abs(all.x + all.w / 2)).toBeLessThan(all.w / 4)
  expect(Math.abs(all.y + all.h / 2)).toBeLessThan(all.h / 4)
})

test('what is taken already stays, and the new one packs against it, outline to outline', () => {
  const taken = shapeOf({ x: -500, y: -300, w: 1000, h: 600 })
  const one = shapeOf({ x: 0, y: 0, w: 300, h: 200 })
  const shift = packed([{ key: 'n', outline: one }], GAP, [taken]).n
  expect(shift).toBeDefined()
  if (!shift) return
  expect(gapOf(taken, moved(one, shift.x, shift.y))).toBeCloseTo(GAP, 0)
})

test('the same spaces pack the same way every time, at any zoom: nothing here knows one', () => {
  expect(packed(sizes, GAP)).toEqual(packed(sizes, GAP))
})

test('a bubble carried through others pushes them aside, smoothly, and none ever meets another', () => {
  const rest = [
    { key: 'a', outline: shapeOf({ x: 600, y: 0, w: 500, h: 400 }) },
    { key: 'b', outline: shapeOf({ x: 1260, y: 40, w: 300, h: 300 }) },
    { key: 'c', outline: shapeOf({ x: 700, y: 600, w: 400, h: 300 }) },
  ]
  for (const dy of [0, 120, -150]) {
    const start = shapeOf({ x: -200, y: dy, w: 400, h: 300 })
    let was: Record<string, Shift> = {}
    for (let step = 1; step <= 260; step++) {
      const held = moved(start, step * 10, 0)
      const now = pushedAside(held, rest, GAP, was)
      const shapes = rest.map(({ key, outline }) => {
        const by = now[key] ?? { x: 0, y: 0 }
        return moved(outline, by.x, by.y)
      })
      for (const shape of shapes) expect(meets(held, shape, GAP - 0.5)).toBe(false)
      for (let i = 0; i < shapes.length; i++)
        for (let j = i + 1; j < shapes.length; j++)
          expect(meets(shapes[i]!, shapes[j]!, GAP - 0.5)).toBe(false)
      for (const { key } of rest) {
        const before = was[key] ?? { x: 0, y: 0 }
        const after = now[key] ?? { x: 0, y: 0 }
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(25)
      }
      was = now
    }
    expect(Object.keys(was).length).toBeGreaterThan(0)
    expect(pushedAside(moved(start, 6000, 0), rest, GAP, was)).toEqual(was)
  }
})

test('two bubbles touch only where their outlines meet: nothing is pushed until they are a gap apart', () => {
  const still = shapeOf({ x: 0, y: 0, w: 400, h: 300 })
  const rest = [{ key: 's', outline: still }]
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [0.7071, 0.7071],
    [-0.6, 0.8],
  ] as const) {
    const start = moved(
      shapeOf({ x: 0, y: 0, w: 300, h: 240 }),
      -150 + 200 - dx * 900,
      -120 + 150 - dy * 900,
    )
    let first: number | null = null
    for (let step = 0; step < 400 && first === null; step++) {
      const held = moved(start, dx * step * 3, dy * step * 3)
      const before = gapOf(held, still)
      if (Object.keys(pushedAside(held, rest, GAP)).length) first = before
    }
    expect(first).not.toBe(null)
    expect(first ?? 99).toBeLessThanOrEqual(GAP)
    expect(first ?? -99).toBeGreaterThan(GAP - 3.5)
  }
})
