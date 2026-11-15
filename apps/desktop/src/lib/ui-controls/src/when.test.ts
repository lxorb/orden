import { describe, expect, test } from 'vitest'
import { agoShort, relativeStep, when } from './when'

describe('a moment, said shortly', () => {
  const now = new Date(2026, 8, 28, 18, 30)
  const time = (at: Date) => new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(at)

  test('is only a time for one from today, whichever date style was asked for', () => {
    const earlier = new Date(2026, 8, 28, 9, 5)

    expect(when(earlier.getTime(), 'medium', now)).toBe(time(earlier))
    expect(when(earlier.getTime(), 'short', now)).toBe(time(earlier))
  })

  test('says its day as well for one from before, in the style asked for', () => {
    const before = new Date(2026, 8, 27, 23, 59)
    const said = (dateStyle: 'short' | 'medium') =>
      new Intl.DateTimeFormat('en', { dateStyle, timeStyle: 'short' }).format(before)

    expect(when(before.getTime(), 'medium', now)).toBe(said('medium'))
    expect(when(before.getTime(), 'short', now)).toBe(said('short'))
    expect(said('medium')).not.toBe(said('short'))
  })

  test('and for the same day of another month or year', () => {
    const lastYear = new Date(2025, 8, 28, 9, 5)
    const lastMonth = new Date(2026, 7, 28, 9, 5)

    expect(when(lastYear.getTime(), 'short', now)).not.toBe(time(lastYear))
    expect(when(lastMonth.getTime(), 'short', now)).not.toBe(time(lastMonth))
  })
})

describe('how long ago, as a step', () => {
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  test('is seconds for the first minute, so this moment reads as this moment', () => {
    expect(relativeStep(0)).toEqual({ value: 0, unit: 'second' })
    expect(relativeStep(2 * SECOND)).toEqual({ value: -2, unit: 'second' })
    expect(relativeStep(59 * SECOND)).toEqual({ value: -59, unit: 'second' })
  })

  test('minutes for the first hour', () => {
    expect(relativeStep(MINUTE)).toEqual({ value: -1, unit: 'minute' })
    expect(relativeStep(90 * SECOND)).toEqual({ value: -2, unit: 'minute' })
    expect(relativeStep(59 * MINUTE)).toEqual({ value: -59, unit: 'minute' })
  })

  test('hours for the first day, and days after that', () => {
    expect(relativeStep(HOUR)).toEqual({ value: -1, unit: 'hour' })
    expect(relativeStep(5 * HOUR)).toEqual({ value: -5, unit: 'hour' })
    expect(relativeStep(DAY)).toEqual({ value: -1, unit: 'day' })
    expect(relativeStep(13 * DAY)).toEqual({ value: -13, unit: 'day' })
  })

  test('and a stamp from the future is now rather than a promise', () => {
    expect(relativeStep(-1)).toEqual({ value: 0, unit: 'second' })
    expect(relativeStep(-5 * MINUTE)).toEqual({ value: 0, unit: 'second' })
  })
})

describe('how long ago, said short', () => {
  test('is the language’s own narrow words, and English for a tag Intl does not know', () => {
    const now = Date.UTC(2026, 9, 5, 12)
    expect(agoShort(now - 3 * 60 * 60 * 1000, 'en', now)).toBe('3h ago')
    expect(agoShort(now, 'en', now)).toBe('now')
    expect(agoShort(now - 2 * 24 * 60 * 60 * 1000, 'not a language', now)).toBe('2d ago')
  })
})
