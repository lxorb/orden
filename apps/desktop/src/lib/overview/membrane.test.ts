import { expect, test } from 'vitest'
import { Membrane, PAD, reach, ringPoint } from './membrane'

const box = { x: 0, y: 0, w: 400, h: 300 }

/** The farthest the membrane reaches to the right. */
const right = (one: Membrane) => Math.max(...one.xs)

test('the ring runs round the box, its normal pointing out', () => {
  const top = ringPoint(box, 20, 0.05)
  expect(top.y).toBe(0)
  expect(top.ny).toBe(-1)
  const half = ringPoint(box, 20, 0.5)
  expect(half.y).toBeGreaterThan(150)
})

test('at rest it stands off the windows, and is never quite still', () => {
  const one = new Membrane(box)
  expect(right(one)).toBeCloseTo(box.w + PAD, 0)
  one.step(1 / 60, 0.2, [])
  const first = one.pathOf()
  for (let frame = 0; frame < 30; frame++) one.step(1 / 60, 0.2 + frame / 60, [])
  expect(one.pathOf()).not.toBe(first)
  expect(first).toMatch(/^M[-\d.]+ [-\d.]+C/)
})

test('a window held past its edge pushes it out round the window, and it springs back', () => {
  const one = new Membrane(box)
  const held = { x: 380, y: 100, w: 200, h: 100 }
  for (let frame = 0; frame < 120; frame++) one.step(1 / 60, frame / 60, [held])
  expect(right(one)).toBeGreaterThan(held.x + held.w)
  for (let frame = 0; frame < 240; frame++) one.step(1 / 60, 2 + frame / 60, [])
  expect(right(one)).toBeLessThan(box.w + PAD + 10)
})

test('a push is felt only near the window, not round the whole cell', () => {
  const far = ringPoint({ x: -PAD, y: -PAD, w: 400 + 2 * PAD, h: 300 + 2 * PAD }, PAD, 0.75)
  expect(reach(far, { x: 420, y: 100, w: 100, h: 100 })).toBe(0)
})

test('asked for less movement it stands still, and still makes room at once', () => {
  const one = new Membrane(box)
  one.step(1 / 60, 0.1, [], true)
  const first = one.pathOf()
  one.step(1 / 60, 0.9, [], true)
  expect(one.pathOf()).toBe(first)
  one.step(1 / 60, 1, [{ x: 380, y: 100, w: 200, h: 100 }], true)
  expect(right(one)).toBeGreaterThan(580)
})
