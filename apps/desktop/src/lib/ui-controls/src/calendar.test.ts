import { describe, expect, test } from 'vitest'
import {
  clockAfter,
  clockWords,
  dateOf,
  dateWords,
  daysAfter,
  monthGrid,
  monthsAfter,
  readClock,
  readDate,
  weekBounds,
} from './calendar'

describe('a day is written as the date fields show it and read back', () => {
  test('only a real calendar day is a date', () => {
    expect(dateOf('2026-02-28')).not.toBeNull()
    expect(dateOf('2026-02-29')).toBeNull()
    expect(dateOf('2026-13-01')).toBeNull()
    expect(dateOf('soon')).toBeNull()
  })
  test('what a field shows reads back as the same day', () => {
    for (const iso of ['2026-11-19', '2027-01-05', '2028-02-29', '1999-12-31']) {
      expect(readDate(dateWords(iso))).toBe(iso)
    }
  })
  test('a typed ISO day is taken as it is, and nonsense is refused', () => {
    expect(readDate('2026-04-30')).toBe('2026-04-30')
    expect(readDate('tomorrowish')).toBeNull()
    expect(readDate('2026-02-30')).toBeNull()
  })
  test('a day typed without a year falls in this year', () => {
    const iso = readDate(dateWords('2026-03-04').replace(/\D?2026\D?/, ' '), '2026-11-19')
    expect(iso).toBe('2026-03-04')
  })
})
describe('stepping through days and months', () => {
  test('days and months roll over, and a month end is kept inside the shorter month', () => {
    expect(daysAfter('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysAfter('2026-03-01', -1)).toBe('2026-02-28')
    expect(monthsAfter('2026-01-31', 1)).toBe('2026-02-28')
    expect(monthsAfter('2026-03-29', -1)).toBe('2026-02-28')
    expect(monthsAfter('2026-11-19', 12)).toBe('2027-11-19')
  })
  test('the days across a summer-time change are each one day apart', () => {
    expect(daysAfter('2026-03-28', 1)).toBe('2026-03-29')
    expect(daysAfter('2026-03-29', 1)).toBe('2026-03-30')
    expect(daysAfter('2026-10-25', 1)).toBe('2026-10-26')
  })
  test('a week starts on the asked weekday', () => {
    expect(weekBounds('2026-11-19', 1)).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(weekBounds('2026-11-19', 0)).toEqual({ from: '2026-11-15', to: '2026-11-21' })
    expect(weekBounds('2026-11-16', 1).from).toBe('2026-11-16')
  })
  test('a month is six whole weeks that hold every day of it', () => {
    const weeks = monthGrid('2026-02-10', 1)
    expect(weeks).toHaveLength(6)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    const inside = weeks.flat().filter((day) => day.inMonth)
    expect(inside.map((day) => day.day)).toEqual(Array.from({ length: 28 }, (_, at) => at + 1))
    expect(weeks[0]?.[0]?.iso).toBe('2026-01-26')
  })
})
describe('a time of day', () => {
  test('is read from the ways people type it', () => {
    expect(readClock('9')).toBe('09:00')
    expect(readClock('930')).toBe('09:30')
    expect(readClock('9:30')).toBe('09:30')
    expect(readClock('09.30')).toBe('09:30')
    expect(readClock('21:05')).toBe('21:05')
    expect(readClock('9:30 pm')).toBe('21:30')
    expect(readClock('12am')).toBe('00:00')
    expect(readClock('12 PM')).toBe('12:00')
    expect(readClock('24:00')).toBeNull()
    expect(readClock('9:75')).toBeNull()
    expect(readClock('later')).toBeNull()
  })
  test('what a field shows reads back as the same time', () => {
    for (const clock of ['00:00', '09:05', '12:30', '23:59']) expect(readClock(clockWords(clock))).toBe(clock)
  })
  test('steps wrap around midnight', () => {
    expect(clockAfter('23:55', 10)).toBe('00:05')
    expect(clockAfter('00:00', -5)).toBe('23:55')
  })
})
