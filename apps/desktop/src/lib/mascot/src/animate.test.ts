import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { animate, IDLE } from './animate'
import { glyph, LOOKS, type Face } from './faces'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function watch(random: () => number) {
  const seen: string[] = []
  const stop = animate(LOOKS.happy, (face: Face) => seen.push(glyph(face)), random)
  return { seen, stop }
}

describe('the animation', () => {
  test('rests first and waits at least the shortest idle before moving', () => {
    const { seen } = watch(() => 0)
    expect(seen).toEqual(['( ͡° ͜ʖ ͡°)'])
    vi.advanceTimersByTime(IDLE.least - 1)
    expect(seen).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(seen.at(-1)).toBe('( ͡– ͜ʖ ͡–)')
  })
  test('goes back to rest once a move ends, and then idles again', () => {
    const { seen } = watch(() => 0)
    vi.advanceTimersByTime(IDLE.least + 140)
    expect(seen.slice(-2)).toEqual(['( ͡– ͜ʖ ͡–)', '( ͡° ͜ʖ ͡°)'])
    vi.advanceTimersByTime(IDLE.least - 1)
    expect(seen).toHaveLength(3)
  })
  test('waits no longer than the longest idle', () => {
    const { seen } = watch(() => 0.999)
    vi.advanceTimersByTime(IDLE.most)
    expect(seen.at(-1)).toBe('( ͡° ͜ʖ ͡–)')
    vi.advanceTimersByTime(420)
    expect(seen.at(-1)).toBe('( ͡° ͜ʖ ͡°)')
  })
  test('plays a double blink with the eyes open between', () => {
    const { seen } = watch(() => 0.5)
    vi.advanceTimersByTime(IDLE.least + 1600 + 140 + 120 + 140)
    expect(seen.slice(1)).toEqual(['( ͡– ͜ʖ ͡–)', '( ͡° ͜ʖ ͡°)', '( ͡– ͜ʖ ͡–)', '( ͡° ͜ʖ ͡°)'])
  })
  test('stops for good when asked', () => {
    const { seen, stop } = watch(() => 0)
    stop()
    vi.advanceTimersByTime(60_000)
    expect(seen).toHaveLength(1)
  })
})
