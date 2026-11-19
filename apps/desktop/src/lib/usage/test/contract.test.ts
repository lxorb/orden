import { describe, expect, test } from 'vitest'
import { changed, ran, stepped, usageChoice, watchUsage } from '../src/api'
import { MOST_QUEUED, pruned } from '../src/queue'

describe('the module stands on its own', () => {
  test('the api loads with nothing watched or sent, and every call is there', () => {
    for (const one of [changed, ran, stepped, watchUsage]) expect(typeof one).toBe('function')
    expect(typeof usageChoice.helping).toBe('boolean')
  })
})
describe('what is kept to be sent', () => {
  type UsageEvent = Parameters<typeof pruned>[0][number]
  const today = '2026-11-14'
  const daily = (day: string) => ({ kind: 'daily', day }) as unknown as UsageEvent
  const counts = (day: string) => ({ kind: 'usage', day }) as unknown as UsageEvent
  test('nothing older than the days kept, and nothing but the daily ping once help is off', () => {
    const old = '2026-10-01'
    expect(pruned([daily(old), daily(today)], today, true)).toEqual([daily(today)])
    expect(pruned([daily(today), counts(today)], today, false)).toEqual([daily(today)])
    expect(pruned([daily(today), counts(today)], today, true)).toHaveLength(2)
  })
  test('and never more than the queue holds', () => {
    const many = Array.from({ length: MOST_QUEUED + 3 }, () => daily(today))
    expect(pruned(many, today, true)).toHaveLength(MOST_QUEUED)
  })
  test('turning help off forgets the install and the days counted', () => {
    usageChoice.setHelping(true)
    const first = usageChoice.install()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    usageChoice.setHelping(false)
    expect(usageChoice.helping).toBe(false)
    usageChoice.setHelping(true)
    expect(usageChoice.install()).not.toBe(first)
  })
})
