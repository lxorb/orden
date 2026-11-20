import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Cadence, FALLBACK, NUDGE, nextPassIn, ONLINE_POLL } from './cadence'

function passes(owed = () => true) {
  const started: number[] = []
  const ends: (() => void)[] = []
  const fired: number[] = []
  let cadence: Cadence | null = null
  const made = new Cadence({
    run: () => {
      started.push(Date.now())
      return new Promise<void>((done) => ends.push(done))
    },
    owed,
    fire: () => {
      fired.push(Date.now())
      cadence?.go()
    },
    next: () => FALLBACK,
  })
  cadence = made
  const end = async () => {
    ends.shift()?.()
    await vi.advanceTimersByTimeAsync(0)
  }
  return { cadence: made, started, fired, end }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
})
describe('a change to the tree (#2280)', () => {
  test('starts a pass at once, where words wait for the nudge', async () => {
    const { cadence, started } = passes()
    cadence.in(NUDGE)
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toEqual([])
    cadence.go()
    expect(started).toEqual([100])
  })
  test('made during a pass starts the next one as that pass ends, not after the fallback', async () => {
    const { cadence, started, end } = passes()
    cadence.go()
    await vi.advanceTimersByTimeAsync(500)
    cadence.go()
    expect(started).toEqual([0])
    await vi.advanceTimersByTimeAsync(500)
    await end()
    expect(started).toEqual([0, 1000])
  })
  test('a pass that left nothing owed waits as long as it was told', async () => {
    const { cadence, started, fired, end } = passes(() => false)
    cadence.go()
    cadence.go()
    await end()
    expect(started).toEqual([0])
    await vi.advanceTimersByTimeAsync(FALLBACK)
    expect(fired).toEqual([FALLBACK])
  })
})
describe('the next pass, with the hub not open (#2280)', () => {
  const at = (online: boolean, hidden: boolean, quiet: number) =>
    nextPassIn({ waiting: false, local: false, hubOpen: false, hidden, online, quiet })
  test('comes within a few seconds while the account answers, however quiet it has been', () => {
    for (let quiet = 0; quiet <= 8; quiet += 1) expect(at(true, false, quiet)).toBe(ONLINE_POLL)
    expect(ONLINE_POLL).toBeLessThanOrEqual(5_000)
  })
  test('backs off only while the account cannot be reached, or the window is hidden', () => {
    expect(at(false, false, 8)).toBeGreaterThan(ONLINE_POLL)
    expect(at(true, true, 8)).toBeGreaterThan(ONLINE_POLL)
  })
  test('after a pass the account did not answer, tries again within seconds even with the hub thought open (#2321)', () => {
    for (const hubOpen of [true, false]) {
      expect(nextPassIn({ waiting: false, local: false, hubOpen, hidden: false, online: false, quiet: 0 })).toBe(2_000)
      expect(nextPassIn({ waiting: false, local: false, hubOpen, hidden: false, online: false, quiet: 8 })).toBe(30_000)
    }
  })
  test('with the hub open waits for its poke, and something unsent comes after the nudge', () => {
    expect(nextPassIn({ waiting: false, local: false, hubOpen: true, hidden: false, online: true, quiet: 0 })).toBe(
      FALLBACK,
    )
    expect(nextPassIn({ waiting: true, local: false, hubOpen: true, hidden: false, online: true, quiet: 0 })).toBe(
      NUDGE,
    )
  })
})
