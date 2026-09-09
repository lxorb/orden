import { describe, expect, test } from 'vitest'
import { approach, arrived } from './ease'

/** Coming up to a number rather than jumping to it, which is what turns twenty
 *  presence packets a second into somebody else's pointer moving rather than hopping. */

describe('coming up to a number', () => {
  test('goes towards it and never past it', () => {
    let at = 0
    for (let step = 0; step < 200; step++) at = approach(at, 100, 16, 70)

    expect(at).toBeGreaterThan(99.9)
    expect(at).toBeLessThanOrEqual(100)
  })

  test('never overshoots, however long the frame was', () => {
    expect(approach(0, 100, 5000, 70)).toBeLessThanOrEqual(100)
    expect(approach(100, 0, 5000, 70)).toBeGreaterThanOrEqual(0)
  })

  /** Frame-rate independent: a frame that took twice as long covers more of the gap,
   *  so a slow frame catches up rather than falling behind. */
  test('covers more of the gap in a longer frame', () => {
    const short = approach(0, 100, 8, 70)
    const long = approach(0, 100, 32, 70)
    expect(long).toBeGreaterThan(short)
  })

  test('closes about two thirds of the gap in one time constant', () => {
    expect(approach(0, 100, 70, 70)).toBeCloseTo(63.2, 0)
  })

  /** A reader who has asked for as little movement as possible gets the packets as
   *  they come, which is what a duration of nothing means everywhere else in the app. */
  test('arrives at once when there is no time to take', () => {
    expect(approach(0, 100, 16, 0)).toBe(100)
    expect(approach(0, 100, 0, 70)).toBe(100)
  })
})

describe('near enough to stop', () => {
  test('is under a pixel at whatever zoom is on', () => {
    expect(arrived({ x: 0, y: 0 }, { x: 0.2, y: 0.2 })).toBe(true)
    expect(arrived({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false)
    // Zoomed out, a plane unit is a fraction of a pixel, so more of them are near
    // enough to stop at.
    expect(arrived({ x: 0, y: 0 }, { x: 4, y: 0 }, 20)).toBe(true)
  })
})
