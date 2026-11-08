import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../../../scripts/growth'
import {
  atClock,
  clockOf,
  dayOf,
  daysAfter,
  endOf,
  HOUR,
  lasting,
  MINUTE,
  near,
  piecesIn,
  startOf,
  stepped,
  ticking,
  totalsOf,
  wholeOf,
} from './days'
import type { Span } from './records'

const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 10, day, hours, minutes).getTime()

const span = (id: string, start: number, end: number | null, activity: string | null = 'uni') =>
  ({
    id,
    start,
    end,
    activity,
    tags: [],
    note: '',
    source: 'manual',
    place: null,
    label: null,
    device: null,
  }) satisfies Span

describe('the days time is counted in', () => {
  test('a week starts on Monday and a month on its first', () => {
    const thursday = at(5, 15)
    expect(new Date(startOf('week', thursday)).getDay()).toBe(1)
    expect(new Date(startOf('week', thursday)).getDate()).toBe(2)
    expect(new Date(startOf('month', thursday)).getDate()).toBe(1)
    expect(startOf('day', thursday)).toBe(at(5, 0))
  })

  test('a range ends where the next one starts, and steps by its own length', () => {
    const week = startOf('week', at(5, 15))
    expect(endOf('week', week)).toBe(stepped('week', week, 1))
    expect(endOf('day', at(5, 0))).toBe(at(6, 0))
    expect(new Date(endOf('month', startOf('month', at(5, 1)))).getMonth()).toBe(11)
    expect(stepped('month', startOf('month', at(5, 1)), -1)).toBe(new Date(2026, 9, 1).getTime())
  })

  test('a day after a day is the next midnight, whatever the clock did between', () => {
    for (let day = 0; day < 400; day += 1) {
      const next = daysAfter(at(1, 0), day)
      expect(dayOf(next)).toBe(next)
    }
  })

  test('a clock typed in lands on that day, and nonsense is nothing', () => {
    expect(atClock(at(5, 0), '9:30')).toBe(at(5, 9, 30))
    expect(atClock(at(5, 0), '24:00')).toBe(at(6, 0))
    expect(atClock(at(5, 0), '25:00')).toBeNull()
    expect(atClock(at(5, 0), 'soon')).toBeNull()
    expect(clockOf(at(5, 7, 5))).toBe('07:05')
  })
})

describe('the time spans add up to', () => {
  test('cuts a span at the edges of the range, across midnight', () => {
    const late = span('a', at(4, 23), at(5, 1))
    const pieces = piecesIn([late], at(5, 0), at(6, 0), at(6, 0))
    expect(pieces.map((one) => [one.from, one.to])).toEqual([[at(5, 0), at(5, 1)]])
  })

  test('a running span counts up to now', () => {
    const running = span('a', at(5, 9), null)
    const pieces = piecesIn([running], at(5, 0), at(6, 0), at(5, 10))
    expect(wholeOf(pieces)).toBe(HOUR)
  })

  test('a running span just started is still shown', () => {
    const running = span('a', at(5, 9), null)
    expect(piecesIn([running], at(5, 0), at(6, 0), at(5, 9))).toHaveLength(1)
  })

  test('overlapping spans of one activity count once, of two activities each', () => {
    const spans = [
      span('a', at(5, 9), at(5, 11)),
      span('b', at(5, 10), at(5, 12)),
      span('c', at(5, 10), at(5, 11), 'sport'),
    ]
    const pieces = piecesIn(spans, at(5, 0), at(6, 0), at(6, 0))
    expect(totalsOf(pieces)).toEqual([
      { activity: 'uni', ms: 3 * HOUR },
      { activity: 'sport', ms: HOUR },
    ])
    expect(wholeOf(pieces)).toBe(3 * HOUR)
  })

  test('leaves out what is outside the range', () => {
    const pieces = piecesIn([span('a', at(3, 9), at(3, 10))], at(5, 0), at(6, 0), at(6, 0))
    expect(pieces).toEqual([])
    expect(totalsOf(pieces)).toEqual([])
  })

  test('is written as hours and minutes, and a timer with seconds', () => {
    expect(lasting(0)).toBe('0:00')
    expect(lasting(90 * MINUTE)).toBe('1:30')
    expect(lasting(25 * HOUR + 59_999)).toBe('25:00')
    expect(ticking(HOUR + 61_000)).toBe('1:01:01')
  })
})

describe('a long history of recorded time', () => {
  const plainly = (spans: readonly Span[], from: number, to: number, now: number) =>
    spans
      .flatMap((one) => {
        const end = one.end ?? Math.max(now, one.start)
        const cut = { span: one, from: Math.max(one.start, from), to: Math.min(end, to) }
        const kept = cut.to > cut.from || (one.end === null && one.start >= from && one.start < to)
        return kept ? [cut] : []
      })
      .sort((one, other) => one.from - other.from)

  test('finds the same pieces as looking at every span', () => {
    let seed = 7
    const next = (most: number) => {
      seed = (seed * 48271) % 2147483647
      return seed % most
    }
    for (let round = 0; round < 200; round += 1) {
      const spans = Array.from({ length: next(40) }, (_, index) => {
        const start = at(1, 0) + next(72) * HOUR
        const end = next(8) === 0 ? null : start + next(30) * HOUR
        return span(`s${index}`, start, end, next(2) ? 'uni' : 'sport')
      })
      const sorted = [...spans].sort((one, other) => one.start - other.start)
      const from = at(1, 0) + next(80) * HOUR
      const to = from + next(30) * HOUR
      const now = at(1, 0) + next(100) * HOUR
      const uni = (one: Span) => one.activity === 'uni'
      for (const list of [spans, sorted]) {
        expect(piecesIn(list, from, to, now)).toEqual(plainly(list, from, to, now))
        expect(piecesIn(list, from, to, now, uni)).toEqual(plainly(list.filter(uni), from, to, now))
      }
    }
  })

  test('looking at one day costs the same after a year as after a week', () => {
    const now = at(20, 12)
    const histories = new Map<number, Span[]>()
    const history = (size: number) => {
      const known = histories.get(size)
      if (known) return known
      const spans = Array.from({ length: size }, (_, index) => {
        const start = now - (size - index) * 3 * MINUTE
        return span(`s${index}`, start, start + 2 * MINUTE)
      })
      histories.set(size, spans)
      return spans
    }
    const ratio = growth(
      (size) => {
        const spans = history(size)
        piecesIn(spans, dayOf(now), daysAfter(dayOf(now), 1), now)
        near(spans, now - 2 * MINUTE, Infinity)
      },
      2000,
      64,
    )
    expect(ratio).toBeLessThan(GROWS_AT_MOST)
  })
})
