import { describe, expect, test } from 'vitest'
import { englishFor, localDate, localNumber, region } from './region'

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
