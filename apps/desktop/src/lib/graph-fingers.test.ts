import { describe, expect, test } from 'vitest'
import { Fingers } from './graph-fingers'

describe('fingers on the graph', () => {
  test('one finger leads, and a second one pinches by how far apart they go and where their middle goes', () => {
    const fingers = new Fingers()
    fingers.press(1, { x: 100, y: 100 })
    expect(fingers.lead).toBe(1)
    expect(fingers.pinching).toBe(false)
    expect(fingers.move(1, { x: 110, y: 100 })).toBeNull()

    fingers.press(2, { x: 210, y: 100 })
    expect(fingers.pinching).toBe(true)
    expect(fingers.move(2, { x: 310, y: 100 })).toEqual({
      at: { x: 210, y: 100 },
      by: 2,
      dx: 50,
      dy: 0,
    })
  })

  test('a finger lifted out of a pinch hands the lead to the one left, from where it is', () => {
    const fingers = new Fingers()
    fingers.press(1, { x: 0, y: 0 })
    fingers.press(2, { x: 100, y: 0 })
    expect(fingers.lift(1)).toEqual({ x: 100, y: 0 })
    expect(fingers.lead).toBe(2)
    expect(fingers.pinching).toBe(false)
    expect(fingers.lift(2)).toBeNull()
    expect(fingers.lead).toBeNull()
  })

  test('a pointer it never saw pressed moves and lifts nothing', () => {
    const fingers = new Fingers()
    fingers.press(1, { x: 0, y: 0 })
    expect(fingers.move(5, { x: 9, y: 9 })).toBeNull()
    expect(fingers.lift(5)).toBeNull()
    expect(fingers.lead).toBe(1)
  })
})
