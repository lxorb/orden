import { describe, expect, test } from 'vitest'
import { dayIso, isoDay, withinRange } from './range'

const day = (date: number) => new Date(2026, 10, date).getTime()
describe('the custom range of the stats', () => {
  test('reads and writes a day as the date field says it, in local time', () => {
    expect(dayIso(day(5))).toBe('2026-11-05')
    expect(isoDay('2026-11-05')).toBe(day(5))
    expect(isoDay('5 Nov')).toBe(null)
  })
  test('never ends before it starts, never reaches past today, and follows the bound just moved', () => {
    expect(withinRange({ kind: 'custom', from: day(3), to: day(9) }, 'to', day(20))).toEqual({
      kind: 'custom',
      from: day(3),
      to: day(9),
    })
    expect(withinRange({ kind: 'custom', from: day(12), to: day(9) }, 'from', day(20)).to).toBe(day(12))
    expect(withinRange({ kind: 'custom', from: day(12), to: day(9) }, 'to', day(20)).from).toBe(day(9))
    expect(withinRange({ kind: 'custom', from: day(3), to: day(25) }, 'to', day(20)).to).toBe(day(20))
  })
})
