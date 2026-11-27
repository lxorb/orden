import { describe, expect, test } from 'vitest'
import { turnOf } from './gestures'

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
