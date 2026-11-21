import { describe, expect, test } from 'vitest'
import { MinuteFold, minuteValue, type Sample } from './minutes'

const sample = (seconds: number, change: Partial<Sample> = {}): Sample => ({
  at: seconds * 1000,
  idleMs: 0,
  lid: true,
  locked: false,
  ...change,
})
function fold(samples: Sample[]) {
  const minutes = new MinuteFold()
  const done = samples.flatMap((one) => minutes.add(one))
  const last = minutes.flush()
  return last ? [...done, last] : done
}
describe('a minute of what the computer did', () => {
  test('counts the seconds with input', () => {
    const [minute] = fold([sample(0), sample(5, { idleMs: 9000 }), sample(10)])
    expect(minute?.active).toBe(10)
    expect(minute?.samples).toBe(3)
  })
  test('closes when the next minute starts, and leaves a gap where the computer slept', () => {
    const minutes = fold([sample(0), sample(55), sample(60), sample(3600)])
    expect(minutes.map((one) => one.at)).toEqual([0, 60_000, 3_600_000])
  })
  test('is locked or shut for the whole minute once it was so for a moment', () => {
    const [locked] = fold([sample(0), sample(5, { locked: true })])
    expect(locked?.locked).toBe(true)
    expect(locked?.active).toBe(5)
    const [shut] = fold([sample(0, { lid: false, locked: true })])
    expect(shut?.lid).toBe(false)
  })
  test('is idle with nobody at it, and keeps what the system could not say as unknown', () => {
    const [minute] = fold([sample(0, { idleMs: 120_000, lid: null })])
    expect(minute?.active).toBe(0)
    expect(minute?.lid).toBeNull()
  })
  test('reads what an older version kept, the machine readings with it', () => {
    const old = {
      at: 60_000,
      active: 30,
      samples: 12,
      cpu: 0.2,
      memory: 0.5,
      battery: 0.9,
      charging: true,
      lid: true,
      locked: false,
    }
    expect(minuteValue(old)).toEqual({
      at: 60_000,
      active: 30,
      samples: 12,
      lid: true,
      locked: false,
      cpu: 0.2,
      memory: 0.5,
      battery: 0.9,
      charging: true,
      ac: null,
      screen: null,
      online: null,
      network: null,
      boot: null,
    })
  })
})
describe('a minute of what the device did', () => {
  test('keeps the processor as a mean, the battery and charging as last said, and a screen off or offline once seen', () => {
    const [minute] = fold([
      sample(0, {
        cpu: 0.2,
        memory: 0.5,
        battery: 0.8,
        charging: false,
        ac: false,
        screen: true,
        online: true,
        network: 'wifi',
        boot: 1000,
      }),
      sample(5, { cpu: 0.6, memory: 0.55, battery: 0.79, charging: true, ac: true, screen: false, online: false }),
      sample(10, { cpu: 1.4, screen: true, online: true }),
    ])
    expect(minute?.cpu).toBeCloseTo(0.6)
    expect(minute).toMatchObject({
      memory: 0.55,
      battery: 0.79,
      charging: true,
      ac: true,
      screen: false,
      online: false,
      network: 'wifi',
      boot: 1000,
    })
  })
  test('is read back from the disk, an older record without the device reading as unknown', () => {
    expect(
      minuteValue({ at: 60_000, active: 10, samples: 2, battery: 0.5, network: 'wifi', online: true }),
    ).toMatchObject({
      battery: 0.5,
      network: 'wifi',
      online: true,
      cpu: null,
    })
    expect(minuteValue({ at: 60_000, active: 10, samples: 2, battery: 7, network: 'radio' })).toMatchObject({
      battery: 1,
      network: null,
    })
    expect(minuteValue({ at: 60_000, active: 10, samples: 2 })).toMatchObject({
      battery: null,
      screen: null,
      boot: null,
    })
  })
})
