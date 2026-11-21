import { describe, expect, test } from 'vitest'
import { fitBytes, fitSeconds } from '../test/fit-maker'
import { readFit } from './fit'
import { healthLine, healthSum, stepBars } from './health'
import { gather, perMinute } from './health-import'

const T = Date.UTC(2026, 10, 19, 6, 0)
const M = 60_000
const s = fitSeconds
const file = fitBytes([
  {
    global: 55,
    fields: [
      [253, 4, 0x86],
      [27, 1, 0x02],
    ],
    rows: [[s(T), 58]],
  },
  {
    global: 55,
    fields: [
      [26, 2, 0x84],
      [27, 1, 0x02],
    ],
    rows: [
      [s(T + M) & 0xffff, 62],
      [s(T + 2 * M) & 0xffff, 0xff],
    ],
  },
  {
    global: 55,
    fields: [
      [253, 4, 0x86],
      [5, 1, 0x00],
      [3, 4, 0x86],
    ],
    rows: [
      [s(T), 6, 1000],
      [s(T + 5 * M), 6, 1400],
      [s(T + 6 * M), 6, 1500],
    ],
  },
  {
    global: 227,
    fields: [
      [0, 2, 0x83],
      [1, 4, 0x86],
    ],
    rows: [
      [30, s(T)],
      [-1 & 0xffff, s(T + M)],
    ],
  },
  {
    global: 275,
    fields: [
      [253, 4, 0x86],
      [0, 1, 0x00],
    ],
    rows: [
      [s(T - 60 * M), 2],
      [s(T - 30 * M), 3],
      [s(T - 10 * M), 1],
    ],
  },
  {
    global: 269,
    fields: [
      [253, 4, 0x86],
      [0, 1, 0x02],
    ],
    rows: [[s(T), 96]],
  },
  {
    global: 297,
    fields: [
      [253, 4, 0x86],
      [0, 2, 0x83],
    ],
    rows: [[s(T), 1450]],
  },
  {
    global: 18,
    fields: [
      [2, 4, 0x86],
      [7, 4, 0x86],
      [5, 1, 0x00],
      [16, 1, 0x02],
      [17, 1, 0x02],
      [11, 2, 0x84],
      [9, 4, 0x86],
    ],
    rows: [[s(T + 60 * M), 1_800_000, 1, 150, 178, 320, 500_000]],
  },
])
describe('a FIT file from the watch', () => {
  test('reads heart rate, steps, stress, sleep, blood oxygen, breathing and the workout', () => {
    const { readings, workouts } = gather(readFit(file))
    const of = (kind: string) => readings.filter((one) => one.kind === kind).map((one) => [one.at, one.value])
    expect(of('heart')).toEqual([
      [T, 58],
      [T + M, 62],
    ])
    expect(of('steps')).toEqual([
      [T + 5 * M, 400],
      [T + 6 * M, 100],
    ])
    expect(of('stress')).toEqual([[T, 30]])
    expect(of('sleep')).toEqual([
      [T - 60 * M, 2],
      [T - 30 * M, 3],
      [T - 10 * M, 1],
    ])
    expect(of('spo2')).toEqual([[T, 96]])
    expect(of('breath')).toEqual([[T, 14.5]])
    expect(workouts).toEqual([
      {
        id: `fit-${String(T + 60 * M)}-1`,
        sport: 'Run',
        start: T + 60 * M,
        end: T + 90 * M,
        heart: 150,
        peak: 178,
        calories: 320,
        meters: 5000,
      },
    ])
  })
  test('refuses what is not a FIT file', () => {
    expect(() => readFit(new TextEncoder().encode('not a fit file at all'))).toThrow('not a FIT file')
  })
})
describe('the health of a range', () => {
  test('readings of a minute are joined, steps added and the rest averaged', () => {
    expect(
      perMinute([
        { kind: 'heart', at: T + 1000, value: 60 },
        { kind: 'heart', at: T + 9000, value: 70 },
        { kind: 'steps', at: T + 1000, value: 10 },
        { kind: 'steps', at: T + 5000, value: 5 },
      ]),
    ).toEqual([
      { kind: 'heart', at: T, value: 65 },
      { kind: 'steps', at: T, value: 15 },
    ])
  })
  test('sums heart rate, steps, sleep by stage, stress, blood oxygen, breathing and the workouts', () => {
    const { readings, workouts } = gather(readFit(file))
    const sum = healthSum(readings, workouts, T - 24 * 60 * M, T + 24 * 60 * M)
    expect(sum.heart).toEqual({ mean: 60, low: 58, high: 62 })
    expect(sum.steps).toBe(500)
    expect(sum.sleep).toEqual({ total: 50 * M, light: 30 * M, deep: 20 * M, rem: 0, awake: M })
    expect(sum.stress).toBe(30)
    expect(sum.spo2).toEqual({ mean: 96, low: 96 })
    expect(sum.breath).toBe(14.5)
    expect(sum.workouts).toHaveLength(1)
    expect(healthSum([], [], 0, 1).heart).toBeNull()
  })
})
test('the lines and step bars of the timeline follow the readings by slot', () => {
  const readings = [
    { kind: 'heart' as const, at: T, value: 40 },
    { kind: 'heart' as const, at: T + 2 * M, value: 190 },
  ]
  expect(healthLine(readings, T, T + 4 * M, M, 40, 190)).toBe('M125.0,30.0 M625.0,2.0')
  const steps = [
    { kind: 'steps' as const, at: T, value: 100 },
    { kind: 'steps' as const, at: T + M, value: 50 },
  ]
  expect(stepBars(steps, T, T + 2 * M, M)).toEqual([
    { from: T, count: 100, share: 1 },
    { from: T + M, count: 50, share: 0.5 },
  ])
})
