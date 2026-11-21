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
test('the device readings come through, and anything unknown is null', () => {
  expect(
    sensedOf({
      idleMs: 0,
      cpu: 0.3,
      memory: 0.4,
      battery: 0.9,
      charging: true,
      ac: true,
      screen: true,
      online: true,
      network: 'wired',
      boot: 5,
    }),
  ).toMatchObject({
    cpu: 0.3,
    memory: 0.4,
    battery: 0.9,
    charging: true,
    ac: true,
    screen: true,
    online: true,
    network: 'wired',
    boot: 5,
  })
  expect(sensedOf({ idleMs: 0, battery: 'full', network: 'radio', charging: 1 })).toMatchObject({
    battery: null,
    network: null,
    charging: null,
  })
})
