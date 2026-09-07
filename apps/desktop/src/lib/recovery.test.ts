import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DAYS,
  DEFAULT_MINUTES,
  keepDays,
  snapshotMinutes,
  staleSnapshots,
} from './recovery'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A fixed afternoon, so what the policy answers never depends on the day the
 *  tests are run. */
const NOW = new Date('2026-03-14T15:00:00Z').getTime()

/** `ago` in whole hours, as the moment it was. */
const hoursAgo = (hours: number) => NOW - hours * HOUR

function kept(taken: number[], days = DEFAULT_DAYS): number[] {
  const stale = new Set(staleSnapshots(taken, NOW, days))
  return taken.filter((one) => !stale.has(one))
}

describe('the settings', () => {
  test('take one of the choices, and nothing else', () => {
    expect(snapshotMinutes(1)).toBe(1)
    expect(snapshotMinutes(0)).toBe(0)
    expect(snapshotMinutes(7)).toBe(DEFAULT_MINUTES)
    expect(snapshotMinutes('5')).toBe(DEFAULT_MINUTES)
    expect(snapshotMinutes(undefined)).toBe(DEFAULT_MINUTES)

    expect(keepDays(30)).toBe(30)
    expect(keepDays(3)).toBe(DEFAULT_DAYS)
    expect(keepDays(null)).toBe(DEFAULT_DAYS)
  })
})

describe('what the sweep keeps', () => {
  test('everything from the last day, however often it was taken', () => {
    const today = [1, 2, 3, 4, 5].map((minutes) => NOW - minutes * MINUTE)
    expect(staleSnapshots(today, NOW)).toEqual([])
  })

  test('nothing older than the retention', () => {
    const old = hoursAgo(8 * 24)
    expect(staleSnapshots([old], NOW, 7)).toEqual([old])
    expect(staleSnapshots([old], NOW, 30)).toEqual([])
  })

  test('one version an hour past the first day', () => {
    // Three of them in the same hour, two days ago.
    const hour = hoursAgo(48)
    const versions = [hour, hour + 10 * MINUTE, hour + 20 * MINUTE]

    expect(kept(versions)).toEqual([hour + 20 * MINUTE])
  })

  test('and one for each of the hours there were', () => {
    const versions = [
      hoursAgo(48),
      hoursAgo(48) + MINUTE,
      hoursAgo(47),
      hoursAgo(47) + MINUTE,
      hoursAgo(46),
    ]

    expect(kept(versions)).toEqual([hoursAgo(48) + MINUTE, hoursAgo(47) + MINUTE, hoursAgo(46)])
  })

  /** A long note written in all day: what the size cap is for. */
  test('a version a minute for a whole day thins to a version an hour', () => {
    const versions: number[] = []
    for (let minute = 0; minute < 24 * 60; minute++) versions.push(hoursAgo(48) + minute * MINUTE)

    expect(versions).toHaveLength(1440)
    expect(kept(versions)).toHaveLength(24)
  })

  test('the day either side of the line is not thinned twice', () => {
    // Just inside the first day, where every version is kept, and just outside
    // it, where the hour keeps one.
    const inside = NOW - DAY + MINUTE
    const outside = NOW - DAY - MINUTE

    expect(staleSnapshots([inside, inside + MINUTE], NOW)).toEqual([])
    expect(staleSnapshots([outside, outside - MINUTE], NOW)).toEqual([outside - MINUTE])
  })

  test('says nothing about a note that has none', () => {
    expect(staleSnapshots([], NOW)).toEqual([])
  })
})
