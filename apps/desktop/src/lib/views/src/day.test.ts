import { afterEach, beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 23, 58))
})
afterEach(() => vi.useRealTimers())
test('the day keeps no clock of its own: it turns over when a shown view or a coming back asks', async () => {
  const { day } = await import('./day.svelte')
  expect(day.today).toBe('2026-11-07')
  vi.advanceTimersByTime(3 * 60_000)
  expect(vi.getTimerCount()).toBe(0)
  expect(day.today).toBe('2026-11-07')
  day.again()
  expect(day.today).toBe('2026-11-08')
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  day.again()
  expect(day.today).toBe('2026-11-10')
})
