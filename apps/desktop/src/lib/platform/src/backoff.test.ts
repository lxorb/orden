import { describe, expect, test } from 'vitest'
import { linkDelay, NUDGE_DELAY, nudgeDelay, pollDelay, roomDelay, saveRetryDelay } from './backoff'

const SECOND = 1000

describe('how often syncing looks for changes', () => {
  test('never returns something a timer cannot use', () => {
    for (const quiet of [0, 1, 5, 8, 40, 1000]) {
      for (const hidden of [false, true]) {
        const delay = pollDelay(quiet, hidden)
        expect(Number.isFinite(delay), `${quiet}/${hidden}`).toBe(true)
        expect(delay).toBeGreaterThan(0)
      }
    }
  })
})

describe('how long a room waits before trying again', () => {
  test('never returns something a timer cannot use', () => {
    for (const tries of [0, 1, 2, 9, 60, 5000]) {
      for (const spread of [0, 0.5, 1]) {
        const delay = roomDelay(tries, spread)
        expect(Number.isFinite(delay), `${tries}/${spread}`).toBe(true)
        expect(delay).toBeGreaterThan(0)
      }
    }
  })
})

describe('how long an online terminal waits before trying again', () => {
  test('tries again in a quarter of a second, then doubles', () => {
    expect([1, 2, 3, 4, 5].map((tries) => linkDelay(tries, false, 0.5))).toEqual([
      250, 500, 1000, 2000, 4000,
    ])
  })

  test('never waits more than five seconds while it is on screen', () => {
    expect(linkDelay(6, false, 0.5)).toBe(5 * SECOND)
    expect(linkDelay(400, false, 0.5)).toBe(5 * SECOND)
    expect(linkDelay(400, false, 1)).toBeLessThanOrEqual(6.5 * SECOND)
  })

  test('waits as a room does while nobody can see it', () => {
    expect(linkDelay(400, true, 0.5)).toBe(20 * SECOND)
  })

  test('never returns something a timer cannot use', () => {
    for (const tries of [0, 1, 2, 9, 60, 5000]) {
      for (const spread of [0, 0.5, 1]) {
        const delay = linkDelay(tries, tries % 2 === 0, spread)
        expect(Number.isFinite(delay), `${tries}/${spread}`).toBe(true)
        expect(delay).toBeGreaterThan(0)
      }
    }
  })
})

describe('how soon a note that would not go down is tried again', () => {
  test('is a moment after the first failure, then twice as long each time', () => {
    expect(saveRetryDelay(1)).toBe(2 * SECOND)
    expect(saveRetryDelay(2)).toBe(4 * SECOND)
    expect(saveRetryDelay(3)).toBe(8 * SECOND)
  })

  test('and never longer than a minute, however long it keeps failing', () => {
    expect(saveRetryDelay(99)).toBe(60 * SECOND)
  })
})

test.each<[unknown, ...Parameters<typeof nudgeDelay>]>([
  [NUDGE_DELAY, 20 * SECOND],
  [NUDGE_DELAY, 10 * 60 * SECOND],
  [400, 400],
  [0, 0],
  [0, -1],
  [0, -10 * SECOND],
])('%j from %j', (expected, ...args) => {
  expect(nudgeDelay(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof pollDelay>]>([
  [20 * SECOND, 0, false],
  [40 * SECOND, 1, false],
  [80 * SECOND, 2, false],
  [120 * SECOND, 3, false],
  [120 * SECOND, 99, false],
  [600 * SECOND, 99, true],
  [20 * SECOND, 0, true],
])('%j from %j', (expected, ...args) => {
  expect(pollDelay(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof roomDelay>]>([
  [400, 1, 0.5],
  [800, 2, 0.5],
  [1600, 3, 0.5],
  [3200, 4, 0.5],
  [20 * SECOND, 20, 0.5],
  [20 * SECOND, 400, 0.5],
  [280, 1, 0],
  [520, 1, 1],
])('%j from %j', (expected, ...args) => {
  expect(roomDelay(...args)).toBe(expected)
})
