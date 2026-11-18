import { describe, expect, test } from 'vitest'
import { heldLine } from '../src/api'

describe('who holds a session', () => {
  test('a session taken over names the device that took it', () => {
    expect(heldLine({ by: 'Phone', since: 0, taken: true })).toBe('Taken over by Phone')
    expect(heldLine({ by: '', since: 0, taken: true })).toBe('Taken over by another device')
  })

  test('a session open elsewhere says since when, with the day only when it was not today', () => {
    const now = new Date(2026, 10, 14, 12, 0).getTime()
    const today = heldLine({ by: 'Phone', since: now - 60_000, taken: false }, now)
    const before = heldLine({ by: 'Phone', since: now - 2 * 86_400_000, taken: false }, now)
    expect(today.startsWith('Open on Phone since ')).toBe(true)
    expect(before.length).toBeGreaterThan(today.length)
  })
})
