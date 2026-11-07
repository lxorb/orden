import { describe, expect, test } from 'vitest'
import { MinuteFold, type Sample, shadeOf } from './minutes'

const sample = (seconds: number, change: Partial<Sample> = {}): Sample => ({
  at: seconds * 1000,
  idleMs: 0,
  cpu: 0.5,
  memory: 0.4,
  battery: 0.8,
  charging: false,
  lid: true,
  locked: false,
  ...change,
})

function fold(samples: Sample[]) {
  const minutes = new MinuteFold()
  const done = samples.flatMap((one) => {
    const closed = minutes.add(one)
    return closed ? [closed] : []
  })
  const last = minutes.flush()
  return last ? [...done, last] : done
}

describe('a minute of what the computer did', () => {
  test('counts the seconds with input, and averages the processor', () => {
    const [minute] = fold([
      sample(0, { cpu: 0.2 }),
      sample(5, { cpu: 0.4, idleMs: 9000 }),
      sample(10, { cpu: 0.6 }),
    ])
    expect(minute?.active).toBe(10)
    expect(minute?.samples).toBe(3)
    expect(minute?.cpu).toBeCloseTo(0.4)
    expect(minute && shadeOf(minute)).toBe('active')
  })

  test('closes when the next minute starts, and leaves a gap where the computer slept', () => {
    const minutes = fold([sample(0), sample(55), sample(60), sample(3600)])
    expect(minutes.map((one) => one.at)).toEqual([0, 60_000, 3_600_000])
  })

  test('is locked or shut for the whole minute once it was so for a moment', () => {
    const [locked] = fold([sample(0), sample(5, { locked: true })])
    expect(locked && shadeOf(locked)).toBe('locked')
    expect(locked?.active).toBe(5)
    const [shut] = fold([sample(0, { lid: false, locked: true })])
    expect(shut && shadeOf(shut)).toBe('shut')
  })

  test('is idle with nobody at it, and keeps what the system could not say as unknown', () => {
    const [minute] = fold([sample(0, { idleMs: 120_000, battery: null, lid: null, cpu: null })])
    expect(minute && shadeOf(minute)).toBe('idle')
    expect(minute?.battery).toBeNull()
    expect(minute?.lid).toBeNull()
    expect(minute?.cpu).toBeNull()
  })

  test('holds shares between nothing and all', () => {
    const [minute] = fold([sample(0, { cpu: 4, memory: -1 })])
    expect(minute?.cpu).toBe(1)
    expect(minute?.memory).toBe(0)
  })
})
