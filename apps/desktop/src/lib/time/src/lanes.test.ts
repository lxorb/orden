import { describe, expect, test } from 'vitest'
import { linearly } from '../../../../../../scripts/growth'
import { HOUR, MINUTE } from './days'
import { bandsOf, bucketsOf, hoursShown, madeOf, stacked, unsaid, within } from './lanes'
import type { Minute } from './minutes'
import type { Span } from './records'

const span = (id: string, start: number, end: number, change: Partial<Span> = {}): Span => ({
  id,
  start,
  end,
  activity: null,
  tags: [],
  note: '',
  source: 'manual',
  place: null,
  label: null,
  device: null,
  ...change,
})

const seen = (id: string, source: Span['source'], place: string, start: number, end: number) =>
  span(id, start, end, { source, place, label: place })

const minutes = (from: number, to: number, change: Partial<Minute> = {}): Minute[] => {
  const out: Minute[] = []
  for (let at = from; at < to; at += MINUTE) {
    out.push({
      at,
      active: 30,
      samples: 12,
      cpu: 0.3,
      memory: 0.5,
      battery: null,
      charging: null,
      lid: true,
      locked: false,
      ...change,
    })
  }
  return out
}

const DAY = 24 * HOUR

describe('a lane of the day', () => {
  test('joins the same app across a short gap, and keeps others apart', () => {
    const spans = [
      seen('a', 'app', 'Firefox', 0, 10 * MINUTE),
      seen('b', 'app', 'Firefox', 11 * MINUTE, 20 * MINUTE),
      seen('c', 'app', 'Code', 20 * MINUTE, 30 * MINUTE),
      seen('d', 'app', 'Firefox', 40 * MINUTE, 50 * MINUTE),
      seen('e', 'site', 'moodle.ethz.ch', 0, 50 * MINUTE),
    ]
    expect(bandsOf(spans, 'app', 0, DAY, DAY).map((one) => [one.key, one.from, one.to])).toEqual([
      ['Firefox', 0, 20 * MINUTE],
      ['Code', 20 * MINUTE, 30 * MINUTE],
      ['Firefox', 40 * MINUTE, 50 * MINUTE],
    ])
  })

  test('a day of many switches between places is drawn in time that grows with the switches', () => {
    const switches = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        seen(`s${index}`, 'tab', `note ${index}`, index * 5000, index * 5000 + 4000),
      )
    const bands = linearly((count) => bandsOf(switches(count), 'tab', 0, DAY, DAY), 16_000)
    expect(bands.length).toBeGreaterThan(1000)
  })
})

describe('what happened in a stretch', () => {
  const spans = [
    span('said', 0, 2 * HOUR, { source: 'timer', activity: 'study' }),
    seen('moodle', 'site', 'moodle.ethz.ch', 0, 90 * MINUTE),
    seen('video', 'site', 'youtube.com', 90 * MINUTE, 2 * HOUR),
    seen('later', 'site', 'news.org', 3 * HOUR, 4 * HOUR),
  ]
  const day = [
    ...minutes(0, 2 * HOUR),
    ...minutes(2 * HOUR, 150 * MINUTE, { locked: true, active: 0 }),
    ...minutes(3 * HOUR, 4 * HOUR),
  ]

  test('is what was said, the active and locked time, and the places, inside it only', () => {
    const found = within(spans, day, 0, 2 * HOUR, DAY)
    expect(found.said).toEqual([{ activity: 'study', ms: 2 * HOUR }])
    expect(found.active).toBe(120 * 30 * 1000)
    expect(found.locked).toBe(0)
    expect(found.places.site.map((one) => [one.key, one.ms])).toEqual([
      ['moodle.ethz.ch', 90 * MINUTE],
      ['youtube.com', 30 * MINUTE],
    ])
    expect(within(spans, day, 2 * HOUR, 3 * HOUR, DAY).locked).toBe(30 * MINUTE)
  })

  test('shows busy time nobody said anything about, once it lasts a quarter of an hour', () => {
    expect(unsaid(spans, day, 0, DAY, DAY)).toEqual([
      { from: 3 * HOUR, to: 4 * HOUR, active: 60 * 30 * 1000 },
    ])
    expect(unsaid(spans, minutes(5 * HOUR, 5 * HOUR + 10 * MINUTE), 0, DAY, DAY)).toEqual([])
  })

  test('says what an activity was really made of', () => {
    expect(madeOf(spans, 'study', 'site', 0, DAY, DAY).map((one) => [one.key, one.ms])).toEqual([
      ['moodle.ethz.ch', 90 * MINUTE],
      ['youtube.com', 30 * MINUTE],
    ])
  })
})

describe('the minutes, gathered for a lane', () => {
  test('say how much of each stretch was seen, busy and away, and the machine in it', () => {
    const day = [
      ...minutes(0, 10 * MINUTE, { active: 60, cpu: 0.2, battery: 0.9 }),
      ...minutes(10 * MINUTE, 15 * MINUTE, { locked: true, active: 0, cpu: 0.4, battery: 0.8 }),
    ]
    const [first, second, third] = bucketsOf(day, 0, 30 * MINUTE, 10 * MINUTE)
    expect(first).toMatchObject({ seen: 1, active: 1, away: 0, battery: 0.9 })
    expect(first?.cpu).toBeCloseTo(0.2)
    expect(second).toMatchObject({ seen: 0.5, active: 0, away: 0.5, battery: 0.8 })
    expect(third).toMatchObject({ seen: 0, active: 0, cpu: null, battery: null })
  })
})

describe('the hours a day is drawn across', () => {
  test('are the working day at least, and reach out to whatever happened outside it', () => {
    expect(hoursShown(0, DAY, [])).toEqual([8 * HOUR, 18 * HOUR])
    expect(hoursShown(0, DAY, [6.5 * HOUR, 21.2 * HOUR])).toEqual([6 * HOUR, 22 * HOUR])
    expect(hoursShown(0, DAY, [-HOUR, 30 * HOUR])).toEqual([8 * HOUR, 18 * HOUR])
    expect(hoursShown(0, DAY, [23.5 * HOUR])).toEqual([8 * HOUR, DAY])
  })
})

describe('entries drawn side by side', () => {
  test('share the room only where they overlap', () => {
    const laid = stacked([
      { id: 'a', from: 0, to: 10 },
      { id: 'b', from: 5, to: 15 },
      { id: 'c', from: 12, to: 20 },
      { id: 'd', from: 30, to: 40 },
    ])
    expect(laid.map((one) => [one.item.id, one.row, one.rows])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
      ['d', 0, 1],
    ])
  })
})
