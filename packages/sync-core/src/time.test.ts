import { describe, expect, test } from 'vitest'
import { MOST_TIME_BYTES, MOST_TIME_CHANGES, timeChangeOf, timeChangesOf, timePageOf } from './time'

describe('a change to a time record', () => {
  test('names a kind, an id and a value, or none for a record taken away', () => {
    expect(timeChangeOf({ kind: 'span', id: 'a1', value: { start: 1 } })).toEqual({
      kind: 'span',
      id: 'a1',
      value: { start: 1 },
    })
    expect(timeChangeOf({ kind: 'span', id: 'a1' })).toEqual({
      kind: 'span',
      id: 'a1',
      value: null,
    })
  })

  test('refuses a kind or an id that is not a plain word', () => {
    expect(timeChangeOf({ kind: 'Span', id: 'a1', value: {} })).toBeNull()
    expect(timeChangeOf({ kind: 'span', id: '../x', value: {} })).toBeNull()
    expect(timeChangeOf({ kind: 'span', id: 'x'.repeat(65), value: {} })).toBeNull()
  })

  test('refuses a value that is not an object, or too large', () => {
    expect(timeChangeOf({ kind: 'span', id: 'a', value: [1] })).toBeNull()
    expect(timeChangeOf({ kind: 'span', id: 'a', value: 'x' })).toBeNull()
    expect(
      timeChangeOf({ kind: 'span', id: 'a', value: { note: 'x'.repeat(MOST_TIME_BYTES) } }),
    ).toBeNull()
  })

  test('comes in a list no longer than the limit, every one of them sound', () => {
    const one = { kind: 'span', id: 'a', value: {} }
    expect(timeChangesOf({ changes: [one] })).toHaveLength(1)
    expect(timeChangesOf({ changes: Array(MOST_TIME_CHANGES + 1).fill(one) })).toBeNull()
    expect(timeChangesOf({ changes: [one, { kind: 1 }] })).toBeNull()
    expect(timeChangesOf({})).toBeNull()
  })
})

describe('a page of time records', () => {
  test('keeps the sound entries and the cursor', () => {
    expect(
      timePageOf({
        entries: [
          { kind: 'span', id: 'a', value: { start: 1 }, seq: 3, at: 9 },
          { kind: 'span', id: 'b', value: { start: 1 } },
        ],
        cursor: 3,
        more: true,
      }),
    ).toEqual({
      entries: [{ kind: 'span', id: 'a', value: { start: 1 }, seq: 3, at: 9 }],
      cursor: 3,
      more: true,
    })
  })

  test('is nothing without a cursor', () => {
    expect(timePageOf({ entries: [] })).toBeNull()
    expect(timePageOf({ error: 'not found' })).toBeNull()
  })
})
