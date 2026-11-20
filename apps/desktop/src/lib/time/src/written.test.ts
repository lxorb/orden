import { describe, expect, test } from 'vitest'
import type { Activity, Span } from './records'
import { csvOf, jsonOf, recordsIn } from './written'

const UNI: Activity = {
  id: 'uni',
  name: 'Uni',
  tint: null,
  icon: null,
  parent: null,
  archived: false,
  order: 1,
}
const span = (change: Partial<Span>): Span => ({
  id: 's',
  start: Date.UTC(2026, 10, 5, 9),
  end: Date.UTC(2026, 10, 5, 10, 30),
  activity: 'uni',
  tags: [],
  note: '',
  source: 'timer',
  place: null,
  label: null,
  device: null,
  ...change,
})
describe('the time as a spreadsheet', () => {
  test('is a row a span, with its activity by name and its length in minutes', () => {
    const lines = csvOf([span({ tags: ['a', 'b'] })], [UNI], 0).split('\r\n')
    expect(lines[0]).toBe('start,end,minutes,activity,tags,note,source,place')
    expect(lines[1]).toBe('2026-11-05T09:00:00.000Z,2026-11-05T10:30:00.000Z,90,Uni,"a, b",,timer,')
  })
  test('quotes what would break a cell, and runs no formula a note starts with', () => {
    const csv = csvOf([span({ note: '=HYPERLINK("x"),\nsecond' })], [UNI], 0)
    expect(csv).toContain(`"'=HYPERLINK(""x""),\nsecond"`)
  })
  test('names a place as Orden shows it, without the file type kept in an older label or the whole path', () => {
    const rows = csvOf(
      [
        span({ source: 'tab', place: '/s/Terminal.term', label: 'Terminal.term' }),
        span({ source: 'tab', place: '/x/Board.canvas', label: null }),
      ],
      [UNI],
      0,
    ).split('\r\n')
    expect(rows[1]?.endsWith(',tab,Terminal')).toBe(true)
    expect(rows[2]?.endsWith(',tab,Board')).toBe(true)
  })
})
describe('the time as a file of its own', () => {
  test('comes back as the records it was written from', () => {
    const records = [{ kind: 'span', id: 'a', value: { start: 1 } }]
    expect(recordsIn(jsonOf(records))).toEqual(records)
  })
  test('is nothing when it is not one, and leaves out a record that is not sound', () => {
    expect(recordsIn('{"records":[]}')).toBeNull()
    expect(recordsIn('not json')).toBeNull()
    const text = JSON.stringify({
      format: 'orden-time',
      records: [
        { kind: 'span', id: '../a', value: {} },
        { kind: 'span', id: 'b', value: [] },
        { kind: 'span', id: 'c', value: { start: 2 } },
      ],
    })
    expect(recordsIn(text)?.map((one) => one.id)).toEqual(['c'])
  })
})
