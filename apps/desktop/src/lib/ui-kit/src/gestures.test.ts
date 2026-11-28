import { describe, expect, test } from 'vitest'
import { pullOf, turnOf } from './gestures'

describe('a sideways swipe', () => {
  test('turns forward when the finger goes left and back when it goes right', () => {
    expect(turnOf(-80, 4)).toBe(1)
    expect(turnOf(80, -4)).toBe(-1)
  })
  test('is not taken from a short drag or from a scroll that drifts sideways', () => {
    expect(turnOf(-40, 0)).toBe(0)
    expect(turnOf(-80, 60)).toBe(0)
    expect(turnOf(0, 200)).toBe(0)
  })
})
describe('a pull down on a list', () => {
  test('follows the finger at half its way, stops growing, and lets go only past its mark', () => {
    expect(pullOf(-20)).toEqual({ shown: 0, away: false })
    expect(pullOf(60)).toEqual({ shown: 30, away: false })
    expect(pullOf(112)).toEqual({ shown: 56, away: true })
    expect(pullOf(900)).toEqual({ shown: 96, away: true })
  })
})
