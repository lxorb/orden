import { describe, expect, test } from 'vitest'
import {
  aimed,
  angleOf,
  arcPath,
  at,
  frameOutline,
  HUB,
  INNER,
  OUTER,
  optionAt,
  optionPiece,
  outlineOf,
  PULL,
  RING,
  slotOf,
  spanOf,
} from './sun-shape'

const near = (value: number, to: number) => expect(Math.abs(value - to)).toBeLessThan(1e-6)
describe('the sun', () => {
  test('counts its angles from the top, clockwise', () => {
    near(at(10, 0)[0], 0)
    near(at(10, 0)[1], -10)
    near(at(10, 90)[0], 10)
    near(at(10, 90)[1], 0)
    near(angleOf(0, -10), 0)
    near(angleOf(10, 0), 90)
    near(angleOf(0, 10), 180)
    near(angleOf(-10, 0), 270)
  })
  test('has its four quarters where the arrows point: up, right, down, left', () => {
    expect([slotOf(0, -50), slotOf(50, 0), slotOf(0, 50), slotOf(-50, 0)]).toEqual([0, 1, 2, 3])
    expect(slotOf(30, -50)).toBe(0)
    expect(slotOf(50, -30)).toBe(1)
  })
  test('draws nothing for a piece too thin or too narrow to see', () => {
    expect(arcPath({ inner: 100, outer: 100.5, from: 0, to: 40 })).toBe('')
    expect(arcPath({ inner: 100, outer: 200, from: 10, to: 10.5 })).toBe('')
    expect(arcPath({ inner: 100, outer: 200, from: 0, to: 40 })).toMatch(/^M.*A200 200 0 0 1 .*L.*A100 100 0 0 0 .*Z$/)
  })
  test('keeps a group of many options no wider than half the sun', () => {
    expect(spanOf(3)).toBe(46)
    expect(spanOf(5) * 5).toBeLessThanOrEqual(200)
  })
})

describe('an option', () => {
  test('grows out of its quarter and fans out from its middle while it opens', () => {
    const shut = optionPiece(0, 0, 3, 0, 0, 0)
    const open = optionPiece(0, 0, 3, 1, 1, 0)
    expect(shut.outer).toBe(shut.inner)
    near(shut.from, 0)
    near(shut.to, 0)
    expect(open.outer).toBe(OUTER + 5)
    near(open.from, -69)
    near(open.to, -23)
  })
  test('stretches with the finger, and widens, when pulled', () => {
    const pulled = optionPiece(3, 1, 2, 1, 1, PULL)
    expect(pulled.outer).toBe(OUTER + 5 + PULL)
    expect(pulled.to - pulled.from).toBeCloseTo(46 * 1.3)
  })
  test('is found by the angle it stands at, loosely past the ends only when asked', () => {
    expect(optionAt(0, 3, 320, false)).toBe(0)
    expect(optionAt(0, 3, 0, false)).toBe(1)
    expect(optionAt(0, 3, 30, false)).toBe(2)
    expect(optionAt(0, 3, 120, false)).toBeNull()
    expect(optionAt(0, 3, 120, true)).toBe(2)
  })
})

describe('a finger dragged out from the middle', () => {
  const counts = [3, 1, 3, 2]
  const toward = (reach: number, angle: number) => at(reach, angle)
  test('aims at nothing while still in the middle', () => {
    expect(aimed(...toward(HUB - 1, 0), null, counts)).toEqual({ open: null, index: null, pull: 0 })
  })
  test('opens the quarter it points into', () => {
    expect(aimed(...toward((HUB + INNER) / 2, 270), null, counts)).toEqual({ open: 3, index: null, pull: 0 })
  })
  test('picks the option it points at once past the quarters, keeping to the open group', () => {
    expect(aimed(...toward(RING + 40, 250), 3, counts)).toEqual({ open: 3, index: 0, pull: 0 })
    expect(aimed(...toward(RING + 40, 300), 3, counts)).toEqual({ open: 3, index: 1, pull: 0 })
  })
  test('is measured past the edge of the option as a pull', () => {
    expect(aimed(...toward(OUTER + 60, 250), 3, counts).pull).toBeCloseTo(60)
  })
  test('ignores a quarter with nothing in it', () => {
    expect(aimed(...toward((HUB + INNER) / 2, 180), null, [3, 1, null, 2])).toEqual({
      open: null,
      index: null,
      pull: 0,
    })
  })
})

describe('the morph', () => {
  test('walks the piece and the frame round the same way, outer edge onto the screen edge on its side', () => {
    const piece = optionPiece(0, 1, 3, 1, 1, 0)
    const outline = outlineOf(piece, 4)
    expect(outline).toHaveLength(16)
    expect(frameOutline(0, 4)[0]).toEqual([0, 0])
    expect(frameOutline(1, 4)[0]).toEqual([1, 0])
    expect(frameOutline(2, 4)[0]).toEqual([1, 1])
    expect(frameOutline(3, 4)[0]).toEqual([0, 1])
    const [x, y] = outline[0] ?? [0, 0]
    expect(Math.hypot(x, y)).toBeCloseTo(piece.outer)
    expect(x).toBeLessThan(0)
  })
})
