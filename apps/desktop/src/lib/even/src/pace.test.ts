import { describe, expect, test } from 'vitest'
import { HOLD, LOAD, quietFor, waitFor } from './pace'

describe('how long the glasses wait before laying a note out again', () => {
  test('wait the usual pause for a note that is quick to lay out', () => {
    expect(quietFor(700, 5)).toBe(700)
  })

  test('wait longer the longer the last layout took, so it never takes most of the time', () => {
    expect(quietFor(80, 400)).toBe(400 * LOAD)
  })

  test('still lay out a note that keeps changing, once the pause has been put off long enough', () => {
    const quiet = quietFor(80, 0)
    let now = 0
    while (waitFor(quiet, 0, now) >= 40) now += 40

    expect(now).toBeLessThanOrEqual(quiet * HOLD)
  })

  test('wait the whole pause after the first change', () => {
    expect(waitFor(700, 1000, 1000)).toBe(700)
  })
})
