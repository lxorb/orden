import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { midnightOf } from '../../platform/src/api'
import { daysAfter, HOUR, MINUTE } from './days'
import { activeIn } from './lanes'
import { type Minute, MinuteFold, type Sample, SAMPLE_EVERY } from './minutes'
import { ANSWER_WITHIN, Sampler } from './sampler'
import type { Sensed } from './sensed'
import { TimeStore } from './store.svelte'

const sample = (at: number, idleMs = 1000): Sample => ({
  at,
  idleMs,
  lid: null,
  locked: false,
})
function folded(from: number, to: number, every: number, idleMs = 1000): Minute[] {
  const fold = new MinuteFold()
  const out: Minute[] = []
  for (let at = from; at <= to; at += every) out.push(...fold.add(sample(at, idleMs)))
  const last = fold.flush()
  return last ? [...out, last] : out
}
const sensed = (idleMs: number): Sensed => ({
  idleMs,
  front: true,
  app: null,
  lid: null,
  locked: false,
})
let owners = 0
async function store(owner: string | null = `active-${(owners += 1)}`) {
  const made = new TimeStore()
  await made.opened({ owner, server: null, device: 'here' })
  return made
}
const settled = () => new Promise((go) => setTimeout(go, 30))
afterEach(() => {
  vi.useRealTimers()
})
describe('the active time of each day', () => {
  test('a window the browser wakes once a minute counts the same active time as one woken every five seconds', () => {
    const start = Date.UTC(2026, 10, 18, 9)
    const often = activeIn(folded(start, start + HOUR, SAMPLE_EVERY), start - HOUR, start + 2 * HOUR)
    const seldom = activeIn(folded(start, start + HOUR, 61_000), start - HOUR, start + 2 * HOUR)
    expect(often).toBeGreaterThanOrEqual(HOUR)
    expect(seldom).toBeGreaterThanOrEqual(HOUR - MINUTE)
    expect(seldom).toBeLessThanOrEqual(often + MINUTE)
  })
  test('the time the computer slept is not counted, nor a minute with nobody at it', () => {
    const start = Date.UTC(2026, 10, 18, 9)
    const fold = new MinuteFold()
    const out = [
      ...fold.add(sample(start)),
      ...fold.add(sample(start + MINUTE)),
      ...fold.add(sample(start + 3 * HOUR)),
      ...fold.add(sample(start + 3 * HOUR + MINUTE, 10 * MINUTE)),
    ]
    const last = fold.flush()
    const minutes = last ? [...out, last] : out
    expect(activeIn(minutes, start - HOUR, start + 4 * HOUR)).toBe(MINUTE + SAMPLE_EVERY)
    expect(minutes.every((one) => one.at < start + 2 * MINUTE || one.at >= start + 3 * HOUR - MINUTE)).toBe(true)
  })
  test('a sample the system never answers is given up on, and the minutes go on being kept', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(Date.UTC(2026, 10, 18, 9))
    const kept: Minute[] = []
    const sampler = new Sampler({
      asked: () => new Promise<Sensed | null>(() => undefined),
      near: () => sensed(500),
      seen: () => undefined,
      leading: () => true,
      kept: (minutes) => kept.push(...minutes),
    })
    for (let round = 0; round < 40; round += 1) {
      const looked = sampler.look()
      await vi.advanceTimersByTimeAsync(ANSWER_WITHIN)
      await looked
      await vi.advanceTimersByTimeAsync(SAMPLE_EVERY - ANSWER_WITHIN)
    }
    sampler.flush()
    expect(kept.length).toBeGreaterThanOrEqual(3)
    expect(activeIn(kept, 0, Infinity)).toBeGreaterThan(3 * MINUTE)
  })
  test('days recorded one after another each read back with their own active time', async () => {
    const kept = await store()
    const first = midnightOf(new Date(2026, 10, 16, 12).getTime())
    const days = (count: number) => daysAfter(first, count)
    const fold = new MinuteFold()
    const worked: [number, number][] = [
      [days(0) + 22 * HOUR, days(1) + 2 * HOUR],
      [days(1) + 9 * HOUR, days(1) + 12 * HOUR],
      [days(2) + 23 * HOUR, days(3) + HOUR],
    ]
    for (const [from, to] of worked) {
      const minutes: Minute[] = []
      for (let at = from; at <= to; at += 61_000) minutes.push(...fold.add(sample(at)))
      const last = fold.flush()
      if (last) minutes.push(last)
      kept.keepMinutes(minutes, to)
      await settled()
    }
    const read = async (day: number) => activeIn(await kept.minutes(day, daysAfter(day, 1)), day, daysAfter(day, 1))
    const near = (ms: number, hours: number) => Math.abs(ms - hours * HOUR) <= 3 * MINUTE
    expect(near(await read(days(0)), 2)).toBe(true)
    expect(near(await read(days(1)), 5)).toBe(true)
    expect(near(await read(days(2)), 1)).toBe(true)
    expect(near(await read(days(3)), 1)).toBe(true)
  })
  test('the minutes kept while signed out come into the account, once', async () => {
    const local = await store(null)
    const at = Date.UTC(2026, 10, 17, 10)
    local.keepMinutes(folded(at, at + 30 * MINUTE, SAMPLE_EVERY), at + HOUR)
    await settled()
    const signed = await store()
    expect(activeIn(await signed.minutes(at, at + HOUR), at, at + HOUR)).toBeGreaterThanOrEqual(30 * MINUTE)
    const again = await store(null)
    expect(await again.minutes(at, at + HOUR)).toEqual([])
  })
})
