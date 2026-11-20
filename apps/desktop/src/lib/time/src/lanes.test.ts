import { describe, expect, test } from 'vitest'
import { HOUR, MINUTE } from './days'
import { hoursShown, stacked, within } from './lanes'
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
      lid: true,
      locked: false,
      ...change,
    })
  }
  return out
}
const DAY = 24 * HOUR
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
})
test('the hours a day is drawn across are the working day at least, and reach out to whatever happened outside it', () => {
  expect(hoursShown(0, DAY, [])).toEqual([8 * HOUR, 18 * HOUR])
  expect(hoursShown(0, DAY, [6.5 * HOUR, 21.2 * HOUR])).toEqual([6 * HOUR, 22 * HOUR])
  expect(hoursShown(0, DAY, [-HOUR, 30 * HOUR])).toEqual([8 * HOUR, 18 * HOUR])
  expect(hoursShown(0, DAY, [23.5 * HOUR])).toEqual([8 * HOUR, DAY])
})
test('entries drawn side by side share the room only where they overlap', () => {
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
