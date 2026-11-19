import { describe, expect, test } from 'vitest'
import {
  addDays,
  addMonths,
  civil,
  dateAt,
  formatDate,
  msOf,
  onClock,
  readDate,
  relative,
  rewritten,
  weekday,
} from './dates'
import type { DateValue } from './types'

describe('dates on the floating clock', () => {
  test('a real date and not', () => {
    expect(civil('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
    expect(civil('2023-02-29')).toBeNull()
    expect(civil('2026-13-01')).toBeNull()
    expect(civil('6.10.2026')).toBeNull()
  })
  test('days and months added the way Moment adds them', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
  })
  test('weekdays, Sunday 0', () => {
    expect(weekday('2026-10-04')).toBe(0)
    expect(weekday('2026-10-05')).toBe(1)
    expect(weekday('1970-01-01')).toBe(4)
    expect(weekday('1969-12-31')).toBe(3)
  })
  test('a moment and back', () => {
    const value = readDate('2026-10-04 16:05:09')
    expect(value).toEqual({ kind: 'date', iso: '2026-10-04', time: '16:05:09' })
    if (value) expect(dateAt(msOf(value))).toEqual(value)
    expect(readDate('2026-10-04T9:05')).toEqual({
      kind: 'date',
      iso: '2026-10-04',
      time: '09:05:00',
    })
    expect(readDate('tomorrow')).toBeNull()
  })
  test('an edit across a change of the clock here keeps the time that was typed', () => {
    const was = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      const winter: DateValue = {
        kind: 'date',
        iso: '2026-03-06',
        time: '19:00:00',
        zone: '-08:00',
      }
      expect(onClock(winter)).toMatchObject({ iso: '2026-03-06', time: '19:00:00' })
      const saved = rewritten(winter, { kind: 'date', iso: '2026-03-09', time: '19:00' })
      expect(onClock(saved)).toMatchObject({ iso: '2026-03-09', time: '19:00:00' })
      const night: DateValue = { kind: 'date', iso: '2026-03-08', time: '01:00:00', zone: '-08:00' }
      const later = rewritten(night, { kind: 'date', iso: '2026-03-08', time: '03:00' })
      expect(onClock(later)).toMatchObject({ iso: '2026-03-08', time: '03:00:00' })
    } finally {
      if (was === undefined) delete process.env.TZ
      else process.env.TZ = was
    }
  })
  test('a moment written in UTC is read on the clock here', () => {
    const was = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      const read = (text: string, zone?: string) => {
        const date = readDate(text)
        return date && onClock(date, zone)
      }
      expect(readDate('2026-11-15T17:00:00Z')).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '17:00:00',
        zone: 'Z',
      })
      expect(read('2026-11-15T17:00:00Z')).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '09:00:00',
      })
      expect(read('2026-11-15T17:00:00.250Z')).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '09:00:00.250',
      })
      expect(read('2026-11-15 17:00:00+09:00', 'Asia/Tokyo')).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '17:00:00',
      })
      expect(read('2026-11-15T23:30-0500', 'Europe/Berlin')).toEqual({
        kind: 'date',
        iso: '2026-11-16',
        time: '05:30:00',
      })
      expect(msOf(readDate('2026-11-15T17:00:00Z')!, 'UTC')).toBe(Date.UTC(2026, 10, 15, 17))
      const tokyo = readDate('2026-03-10T23:00:00+09:00')!
      expect(rewritten(tokyo, { kind: 'date', iso: '2026-03-10', time: '08:30' })).toEqual({
        kind: 'date',
        iso: '2026-03-11',
        time: '00:30:00',
        zone: '+09:00',
      })
      expect(rewritten(tokyo, { kind: 'date', iso: '2026-03-12' })).toEqual({
        kind: 'date',
        iso: '2026-03-12',
      })
      expect(readDate('2026-11-15T17:00:00')).toEqual({
        kind: 'date',
        iso: '2026-11-15',
        time: '17:00:00',
      })
    } finally {
      if (was === undefined) delete process.env.TZ
      else process.env.TZ = was
    }
  })
  test.each([
    ['YYYY-MM-DD', '2026-10-04'],
    ['YY/M/D', '26/10/4'],
    ['MMMM Do, YYYY', 'October 4th, 2026'],
    ['MMM D', 'Oct 4'],
    ['dddd ddd dd d E', 'Sunday Sun Su 0 7'],
    ['HH:mm:ss H h hh A a', '16:05:09 16 4 04 PM pm'],
    ['[Week] W, Q', 'Week 40, 4'],
    ['DDDD', '277'],
  ])('%s is %s', (format, expected) => {
    expect(formatDate({ kind: 'date', iso: '2026-10-04', time: '16:05:09' }, format)).toBe(expected)
  })
  test.each([
    [0, 'a few seconds ago'],
    [-30 * 60_000, '30 minutes ago'],
    [2 * 3_600_000, 'in 2 hours'],
    [-26 * 3_600_000, 'a day ago'],
    [-3 * 86_400_000, '3 days ago'],
    [40 * 86_400_000, 'in a month'],
    [-100 * 86_400_000, '3 months ago'],
    [-400 * 86_400_000, 'a year ago'],
    [-800 * 86_400_000, '2 years ago'],
  ])('%i ms from now is %s', (offset, expected) => {
    expect(relative(1_000_000_000_000 + offset, 1_000_000_000_000)).toBe(expected)
  })
})
describe('a time with a fraction of a second', () => {
  const at = (time: string) => msOf({ kind: 'date', iso: '2026-01-01', time })
  test('counts the fraction once', () => {
    expect(at('10:00:05.750') - at('10:00:05')).toBe(750)
    expect(at('10:00:05.900')).toBeLessThan(at('10:00:06.100'))
    expect(formatDate(dateAt(at('10:00:05.750')), 'HH:mm:ss.SSS')).toBe('10:00:05.750')
  })
})
