import { describe, expect, test } from 'vitest'
import { elapsed, englishFor, localDate, localNumber, midnightOf, region } from './region'

const AFTERNOON = Date.UTC(2026, 10, 12, 13, 5)

describe('the region the app formats with', () => {
  test('is English, laid out the way the system’s region writes it', () => {
    expect(englishFor('de-CH')).toBe('en-CH-u-hc-h23')
    expect(englishFor('en-US')).toBe('en-US-u-hc-h12')
    expect(englishFor('ja')).toMatch(/^en-JP\b/)
  })

  test('so a clock keeps the system’s hours while the words stay English', () => {
    const swiss = new Intl.DateTimeFormat(englishFor('de-CH'), {
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(AFTERNOON)
    expect(swiss).toContain('November')
    expect(swiss).toContain('13:05')
  })

  test('is what dates and numbers are written in', () => {
    expect(localDate(AFTERNOON, { dateStyle: 'medium', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat(region(), { dateStyle: 'medium', timeZone: 'UTC' }).format(AFTERNOON),
    )
    expect(localNumber(12345.5)).toBe(new Intl.NumberFormat(region()).format(12345.5))
    expect(region()).toMatch(/^en\b/)
  })
})

describe('a length on a clock', () => {
  test('reads as minutes and seconds, with hours only past the hour', () => {
    expect([elapsed(0), elapsed(9), elapsed(70), elapsed(725.4)]).toEqual(['0:00', '0:09', '1:10', '12:05'])
    expect([elapsed(3609), elapsed(3600 * 2 + 61)]).toEqual(['1:00:09', '2:01:01'])
  })

  test('and never reads as a negative one', () => {
    expect(elapsed(-5)).toBe('0:00')
  })
})

describe('the midnight a moment falls after', () => {
  test('is the start of its day on this clock', () => {
    const at = new Date(2026, 8, 12, 23, 59).getTime()
    expect(midnightOf(at)).toBe(new Date(2026, 8, 12).getTime())
    expect(midnightOf(midnightOf(at))).toBe(midnightOf(at))
  })
})
