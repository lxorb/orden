import { describe, expect, test } from 'vitest'
import type { Span } from '../src/records'
import { csvOf, jsonOf, recordsIn } from '../src/written'

describe('what the time is written out as', () => {
  const span: Span = {
    id: 's',
    start: Date.UTC(2026, 10, 5, 9),
    end: Date.UTC(2026, 10, 5, 10, 30),
    activity: 'uni',
    tags: [],
    note: '=SUM(A1)',
    source: 'timer',
    place: null,
    label: null,
    device: null,
  }
  const uni = { id: 'uni', name: 'Uni', tint: null, parent: null, archived: false, order: 1 }

  test('a spreadsheet row a span, its length in minutes, and no formula a note starts with', () => {
    const [head, row] = csvOf([span], [uni], 0).split('\r\n')
    expect(head).toBe('start,end,minutes,activity,tags,note,source,place')
    expect(row).toBe("2026-11-05T09:00:00.000Z,2026-11-05T10:30:00.000Z,90,Uni,,'=SUM(A1),timer,")
  })

  test('the records come back from their own file and from nothing else', () => {
    const records = [{ kind: 'span', id: 'a1', value: { start: 1 } }]
    expect(recordsIn(jsonOf(records))).toEqual(records)
    expect(recordsIn('{"format":"other","records":[]}')).toBeNull()
    expect(recordsIn('not json')).toBeNull()
    expect(recordsIn(jsonOf([{ kind: 'Span!', id: 'a1', value: {} }]))).toEqual([])
  })
})
