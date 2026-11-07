import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { atItsCost } from './at-its-cost'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a call that waits as long as it costs', () => {
  let clock = 0

  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  const settle = () => {
    for (let step = 0; step < 4; step++) vi.advanceTimersByTime(20)
  }

  test('runs at once, once for all asked before, then no sooner than twice what it cost', () => {
    let ran = 0
    const later = atItsCost(() => {
      ran++
      clock += 100
    })

    later()
    later()
    settle()
    expect(ran).toBe(1)

    later()
    later()
    settle()
    expect(ran).toBe(1)

    vi.advanceTimersByTime(100)
    expect(ran).toBe(1)
    vi.advanceTimersByTime(100)
    expect(ran).toBe(2)
  })

  test('a cheap run is asked again at once', () => {
    let ran = 0
    const later = atItsCost(() => ran++)

    later()
    settle()
    later()
    settle()
    expect(ran).toBe(2)
  })

  test('drops what was asked when cancelled, and runs it now when flushed', () => {
    let ran = 0
    const later = atItsCost(() => ran++)

    later()
    later.cancel()
    vi.advanceTimersByTime(10)
    expect(ran).toBe(0)

    later()
    later.flush()
    expect(ran).toBe(1)
    vi.advanceTimersByTime(10)
    expect(ran).toBe(1)
  })
})
