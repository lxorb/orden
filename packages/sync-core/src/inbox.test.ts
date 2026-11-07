import { describe, expect, test } from 'vitest'
import { inboxChangeOf, inboxStamp, mergedInbox, newer } from './inbox'

describe('an inbox stamp', () => {
  test('sorts by time, then by count, then by device, as text', () => {
    const stamps = [
      inboxStamp(2_000, 0, 'b'),
      inboxStamp(1_000, 9, 'a'),
      inboxStamp(1_000, 10, 'a'),
      inboxStamp(2_000, 0, 'a'),
    ]
    expect([...stamps].sort()).toEqual([stamps[1], stamps[2], stamps[3], stamps[0]])
    expect(newer(stamps[0], stamps[3])).toBe(true)
    expect(newer(undefined, stamps[3])).toBe(false)
    expect(newer(stamps[3], undefined)).toBe(true)
  })

  test('is read back by the wire', () => {
    const stamp = inboxStamp(Date.UTC(2026, 10, 7), 3, 'laptop-1')
    expect(
      inboxChangeOf({ id: 'a', fields: { text: 'x' }, stamps: { text: stamp } }),
    ).not.toBeNull()
  })
})

describe('merging a change into a to-do', () => {
  test('takes each field whose stamp is later and says whether anything changed', () => {
    const held = {
      fields: { text: 'a', due: '1' },
      stamps: { text: inboxStamp(5, 0, 'x'), due: inboxStamp(1, 0, 'x') },
    }
    const merged = mergedInbox(held, {
      fields: { text: 'b', due: '2' },
      stamps: { text: inboxStamp(3, 0, 'y'), due: inboxStamp(3, 0, 'y') },
    })
    expect(merged.fields).toEqual({ text: 'a', due: '2' })
    expect(merged.changed).toBe(true)
    expect(
      mergedInbox(merged, { fields: { due: '9' }, stamps: { due: inboxStamp(2, 0, 'z') } }).changed,
    ).toBe(false)
  })
})
