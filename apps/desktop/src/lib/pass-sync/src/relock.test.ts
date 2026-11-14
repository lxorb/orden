import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Relock } from './relock.svelte'
import type { RelockAfter } from './settings'

let after: RelockAfter = 10
let locked = 0
const relock = () =>
  new Relock(
    () => after,
    () => locked++,
  )

beforeEach(() => {
  vi.useFakeTimers()
  after = 10
  locked = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('locking after time away', () => {
  test('locks once the chosen minutes have passed away', () => {
    after = 1
    const one = relock()
    one.away()
    vi.advanceTimersByTime(59_999)
    expect(locked).toBe(0)
    vi.advanceTimersByTime(1)
    expect(locked).toBe(1)
  })

  test('coming back in time keeps it open', () => {
    after = 5
    const one = relock()
    one.away()
    vi.advanceTimersByTime(4 * 60_000)
    one.back()
    vi.advanceTimersByTime(10 * 60_000)
    expect(locked).toBe(0)
  })

  test('leaving twice counts from the last time', () => {
    after = 2
    const one = relock()
    one.away()
    vi.advanceTimersByTime(60_000)
    one.away()
    vi.advanceTimersByTime(60_000)
    expect(locked).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(locked).toBe(1)
  })

  test('0 never locks while Orden runs', () => {
    after = 0
    const one = relock()
    one.away()
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(locked).toBe(0)
  })

  test('reads the chosen minutes when leaving, not when made', () => {
    const one = relock()
    after = 1
    one.away()
    vi.advanceTimersByTime(60_000)
    expect(locked).toBe(1)
  })
})
