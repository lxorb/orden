import { describe, expect, test } from 'vitest'
import { sensedOf, withIdle } from './sensed'

describe('what the system says of the person at the computer', () => {
  test('where it cannot say how long since the last input, the window’s own count stands in', () => {
    const said = sensedOf({ idleMs: null, front: true, app: 'XTerm' })
    expect(said && withIdle(said, 400_000).idleMs).toBe(400_000)
  })

  test('where it can, its count stands', () => {
    const said = sensedOf({ idleMs: 1_000, front: false })
    expect(said && withIdle(said, 400_000).idleMs).toBe(1_000)
  })
})
