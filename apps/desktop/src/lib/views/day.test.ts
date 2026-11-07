import { afterEach, beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 23, 58))
})

afterEach(() => vi.useRealTimers())

test('the day turns over at midnight without anything else changing, and on coming back', async () => {
  const { day } = await import('./day.svelte')
  expect(day.today).toBe('2026-11-07')

  vi.advanceTimersByTime(3 * 60_000)
  expect(day.today).toBe('2026-11-08')

  vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  day.again()
  expect(day.today).toBe('2026-11-10')
})
