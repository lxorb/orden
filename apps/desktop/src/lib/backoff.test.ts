import { describe, expect, test } from 'vitest'
import { pollDelay, roomDelay } from './backoff'

const SECOND = 1000

describe('how often syncing looks for changes', () => {
  test('is quick right after something moved', () => {
    expect(pollDelay(0, false)).toBe(20 * SECOND)
  })

  test('doubles for each pass that found nothing', () => {
    expect(pollDelay(1, false)).toBe(40 * SECOND)
    expect(pollDelay(2, false)).toBe(80 * SECOND)
  })

  test('stops slowing down while the window is on screen', () => {
    expect(pollDelay(3, false)).toBe(120 * SECOND)
    expect(pollDelay(99, false)).toBe(120 * SECOND)
  })

  test('goes much slower when nobody is looking', () => {
    // Coming back to the window syncs at once, so this staleness is never seen.
    expect(pollDelay(99, true)).toBe(600 * SECOND)
  })

  test('is still quick when hidden if something just moved', () => {
    // A backgrounded window that is mid-sync should not stall on the first pass.
    expect(pollDelay(0, true)).toBe(20 * SECOND)
  })

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
  test('tries again almost at once the first time', () => {
    // A network that came back a moment later is the usual reason a socket went.
    expect(roomDelay(1, 0.5)).toBe(400)
  })

  test('doubles for each try after that', () => {
    expect(roomDelay(2, 0.5)).toBe(800)
    expect(roomDelay(3, 0.5)).toBe(1600)
    expect(roomDelay(4, 0.5)).toBe(3200)
  })

  test('stops at a wait short enough to be back before the words are on screen', () => {
    expect(roomDelay(20, 0.5)).toBe(20 * SECOND)
    expect(roomDelay(400, 0.5)).toBe(20 * SECOND)
  })

  test('spreads either side, so twenty notes do not all ask in one millisecond', () => {
    expect(roomDelay(1, 0)).toBe(280)
    expect(roomDelay(1, 1)).toBe(520)
  })

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
