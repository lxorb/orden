import { describe, expect, test } from 'vitest'
import { HOUR, MINUTE } from './days'
import { dueOf, lengthIn, LONG_TIMER, reachedOf } from './goals'
import type { Goal, Span } from './records'

const at = (day: number, hours: number) => new Date(2026, 10, day, hours).getTime()

const span = (id: string, start: number, end: number | null, change: Partial<Span> = {}): Span => ({
  id,
  start,
  end,
  activity: 'uni',
  tags: [],
  note: '',
  source: 'manual',
  space: null,
  site: null,
  label: null,
  device: null,
  ...change,
})

const DAILY: Goal = { id: 'day-uni', activity: 'uni', per: 'day', ms: 2 * HOUR }
const WEEKLY: Goal = { id: 'week-uni', activity: 'uni', per: 'week', ms: 10 * HOUR }

describe('a goal', () => {
  test('counts the activity’s time in the day or week it is in, and no other', () => {
    const spans = [
      span('a', at(4, 9), at(4, 12)),
      span('b', at(5, 9), at(5, 10)),
      span('c', at(5, 9), at(5, 11), { activity: 'sport' }),
    ]
    expect(reachedOf(DAILY, spans, at(5, 20))).toBe(HOUR)
    expect(reachedOf(WEEKLY, spans, at(5, 20))).toBe(4 * HOUR)
  })

  test('is said in hours and minutes, or in hours', () => {
    expect(lengthIn('1:30')).toBe(90 * MINUTE)
    expect(lengthIn('2')).toBe(2 * HOUR)
    expect(lengthIn('1,5')).toBe(90 * MINUTE)
    expect(lengthIn('')).toBeNull()
    expect(lengthIn('0')).toBeNull()
    expect(lengthIn('soon')).toBeNull()
    expect(lengthIn('1:75')).toBeNull()
  })
})

describe('what is due to be told', () => {
  test('is a goal once it is reached, once in its day', () => {
    const spans = [span('a', at(5, 9), at(5, 12))]
    const due = dueOf([DAILY, WEEKLY], spans, at(5, 13), new Set())
    expect(due.map((one) => one.kind)).toEqual(['goal'])
    const told = new Set(due.map((one) => one.key))
    expect(dueOf([DAILY], spans, at(5, 14), told)).toEqual([])
    const tomorrow = [...spans, span('b', at(6, 9), at(6, 12))]
    expect(dueOf([DAILY], tomorrow, at(6, 13), told)).toHaveLength(1)
  })

  test('is a timer left running for hours, once', () => {
    const running = [span('t', at(5, 8), null, { source: 'timer' })]
    expect(dueOf([], running, at(5, 8) + LONG_TIMER - 1, new Set())).toEqual([])
    const due = dueOf([], running, at(5, 8) + LONG_TIMER, new Set())
    expect(due.map((one) => [one.kind, one.ms])).toEqual([['timer', LONG_TIMER]])
    expect(dueOf([], running, at(5, 20), new Set(due.map((one) => one.key)))).toEqual([])
  })
})
