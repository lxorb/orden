import { describe, expect, test } from 'vitest'
import { anchorShift, indexed, inSight } from './tree-settle'

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
function shift(now: string[], first: number, last: number): number {
  return anchorShift(ROWS, indexed(now), first, last)
}
describe('where the list holds the rows in view', () => {
  test('rows come in above the view: the view goes down with what it showed', () => {
    expect(shift(['x', 'y', ...ROWS], 3, 6)).toBe(2)
  })
  test('rows go above the view: up by as many', () => {
    expect(shift(['b', 'c', 'd', 'e', 'f', 'g', 'h'], 3, 6)).toBe(-1)
  })
  test('a row deleted in view moves nothing above it', () => {
    expect(shift(['a', 'b', 'c', 'd', 'f', 'g', 'h'], 3, 6)).toBe(0)
  })
  test('a row in view moved away is not what the view follows', () => {
    expect(shift(['a', 'b', 'c', 'e', 'f', 'g', 'h', 'd'], 3, 6)).toBe(-1)
    expect(shift(['d', 'a', 'b', 'c', 'e', 'f', 'g', 'h'], 3, 6)).toBe(0)
  })
  test('rows only rearranged among those in view leave it where it is', () => {
    expect(shift(['a', 'b', 'c', 'e', 'd', 'g', 'f', 'h'], 3, 6)).toBe(0)
  })
  test('nothing in view is left: nothing to hold', () => {
    expect(shift(['x', 'y'], 3, 6)).toBe(0)
  })
})
describe('one row in view', () => {
  test('is what the view holds on to', () => {
    expect(shift(['x', ...ROWS], 3, 3)).toBe(1)
  })
})
describe('a row the switch to its note needs to scroll to', () => {
  const rows = (top: number, room: number) => ({ count: 40, height: 28, top, room, overscan: 4, fold: null })
  test('is none while the whole row is in sight', () => {
    expect(inSight(0, rows(0, 280))).toBe(true)
    expect(inSight(9, rows(0, 280))).toBe(true)
    expect(inSight(12, rows(280, 280))).toBe(true)
  })
  test('is one cut by an edge, out of sight, or in a list not measured yet', () => {
    expect(inSight(10, rows(0, 280))).toBe(false)
    expect(inSight(0, rows(20, 280))).toBe(false)
    expect(inSight(30, rows(0, 280))).toBe(false)
    expect(inSight(0, rows(0, 0))).toBe(false)
  })
})
