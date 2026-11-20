import { describe, expect, test } from 'vitest'
import { linearly } from '../../../../../../scripts/growth'
import { HOUR, MINUTE } from './days'
import type { Span } from './records'
import { barsOf, levelsOf, slotsFor } from './slots'

const seen = (id: string, place: string, start: number, end: number): Span => ({
  id,
  start,
  end,
  activity: null,
  tags: [],
  note: '',
  source: 'site',
  place,
  label: place,
  device: null,
})
const DAY = 24 * HOUR
describe('a row of places drawn as flat bars', () => {
  test('a visit of a few seconds still takes its slot and does not vanish', () => {
    const bars = barsOf([seen('a', 'short.example', 10 * HOUR, 10 * HOUR + 8000)], 'site', 0, DAY, 250, DAY)
    expect(bars.map((one) => one.key)).toEqual(['short.example'])
    expect(bars[0]?.to).toBeCloseTo((bars[0]?.from ?? 0) + DAY / 250)
  })
  test('neighbouring slots of the same place are one bar, and each slot goes to the place with the most time in it', () => {
    const spans = [
      seen('a', 'moodle', 9 * HOUR, 10 * HOUR),
      seen('b', 'moodle', 10 * HOUR + MINUTE, 11 * HOUR),
      seen('c', 'mail', 11 * HOUR, 11 * HOUR + 3 * MINUTE),
      seen('d', 'news', 11 * HOUR + 3 * MINUTE, 11 * HOUR + 4 * MINUTE),
    ]
    const bars = barsOf(spans, 'site', 0, DAY, 96, DAY)
    expect(bars.map((one) => [one.key, one.from, one.to])).toEqual([
      ['moodle', 9 * HOUR, 11 * HOUR],
      ['mail', 11 * HOUR, 11 * HOUR + 15 * MINUTE],
    ])
  })
  test('drawn wider, the slots are cut again and the same time is shown finer', () => {
    const spans = [
      seen('a', 'moodle', 9 * HOUR, 9 * HOUR + 20 * MINUTE),
      seen('b', 'mail', 9 * HOUR + 20 * MINUTE, 10 * HOUR),
    ]
    expect(barsOf(spans, 'site', 0, DAY, 24, DAY).map((one) => one.key)).toEqual(['mail'])
    expect(barsOf(spans, 'site', 0, DAY, 96, DAY).map((one) => one.key)).toEqual(['moodle', 'mail'])
    expect(slotsFor(400)).toBe(100)
    expect(slotsFor(0)).toBe(1)
  })
  test('the active row is as high as the share of its minutes that had input', () => {
    const minutes = [0, 1, 2, 3].map((index) => ({
      at: HOUR + index * MINUTE,
      active: index < 2 ? 60 : 0,
      samples: 12,
      lid: null,
      locked: false,
    }))
    expect(levelsOf(minutes, 0, DAY, 96)).toEqual([{ from: HOUR, to: HOUR + 15 * MINUTE, share: 0.5 }])
  })
  test('a day of many switches between places is drawn in time that grows with the switches', () => {
    const switches = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        seen(`s${index}`, `note ${index % 7}`, index * 5000, index * 5000 + 4000),
      )
    const bars = linearly((count) => barsOf(switches(count), 'site', 0, DAY, 400, DAY), 16_000)
    expect(bars.length).toBeGreaterThan(10)
  })
})
