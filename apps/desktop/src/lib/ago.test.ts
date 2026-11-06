import { describe, expect, test } from 'vitest'

import { agoShort, relativeStep } from './ago'

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
