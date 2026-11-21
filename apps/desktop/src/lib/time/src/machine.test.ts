import { describe, expect, test } from 'vitest'
import { deviceSlots, deviceSum, gapsIn, sensesDevice } from './machine'
import type { Minute } from './minutes'

const M = 60_000
const minute = (index: number, change: Partial<Minute> = {}): Minute => ({
  at: index * M,
  active: 30,
  samples: 12,
  lid: true,
  locked: false,
  boot: 1,
  ...change,
})
describe('the device over a day', () => {
  test('a gap with the same boot is asleep, a gap after which it booted again is off', () => {
    const minutes = [minute(0), minute(1), minute(30), minute(31, { boot: 31 * M }), minute(90, { boot: 31 * M })]
    expect(gapsIn(minutes, 0, 200 * M)).toEqual([
      { from: 2 * M, to: 30 * M, kind: 'asleep' },
      { from: 32 * M, to: 90 * M, kind: 'asleep' },
    ])
    const restarted = [minute(0), minute(10, { boot: 9 * M })]
    expect(gapsIn(restarted, 0, 20 * M)).toEqual([{ from: M, to: 10 * M, kind: 'off' }])
    expect(gapsIn([minute(0), minute(3)], 0, 10 * M)).toEqual([])
  })
  test('sums the battery, power, load, screen and network', () => {
    const minutes = [
      minute(0, { battery: 0.9, ac: false, cpu: 0.2, memory: 0.4, online: true }),
      minute(1, { battery: 0.6, ac: false, cpu: 0.6, memory: 0.6, screen: false, online: false }),
      minute(2, { battery: 0.7, ac: true, charging: true, cpu: 0.4, memory: 0.5, online: true }),
      minute(20, { battery: 0.8, ac: true, charging: true }),
    ]
    const sum = deviceSum(minutes, 0, 60 * M)
    expect(sum.battery).toEqual({ now: 0.8, low: 0.6, high: 0.9 })
    expect(sum).toMatchObject({ onBattery: 2 * M, charging: 2 * M, screenOff: M, offline: M, asleep: 17 * M, off: 0 })
    expect(sum.cpu?.mean).toBeCloseTo(0.4)
    expect(sum.cpu?.peak).toBe(0.6)
    expect(sum.memory?.peak).toBe(0.6)
  })
  test('nothing from the device says nothing, and slots keep the last battery and the mean load', () => {
    const plain = [{ at: 0, active: 30, samples: 12, lid: true, locked: false }]
    expect(sensesDevice(plain)).toBe(false)
    expect(deviceSum(plain, 0, M)).toMatchObject({ battery: null, cpu: null, onBattery: 0, asleep: 0 })
    const slots = deviceSlots(
      [minute(0, { battery: 0.5, cpu: 0.2 }), minute(1, { battery: 0.4, cpu: 0.4, charging: true })],
      0,
      4 * M,
      2 * M,
    )
    expect(slots[0]).toMatchObject({ battery: 0.4, charging: true })
    expect(slots[0]?.cpu).toBeCloseTo(0.3)
    expect(slots[1]).toMatchObject({ battery: null, cpu: null, charging: false })
    expect(sensesDevice([minute(0)])).toBe(true)
  })
})
