import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { startsBefore, waitedUntil } from './turns'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})
describe('a wait until a deadline', () => {
  test('ends when the deadline comes, before the time asked for', async () => {
    const deadline = new AbortController()
    let landed = false
    const waiting = waitedUntil(10_000, deadline.signal).then(() => (landed = true))
    await vi.advanceTimersByTimeAsync(100)
    expect(landed).toBe(false)
    deadline.abort()
    await waiting
    expect(landed).toBe(true)
  })
})
describe('work queued to start before a deadline', () => {
  function queue() {
    let ahead = Promise.resolve()
    return <T>(run: () => Promise<T>): Promise<T> => {
      const turn = ahead.then(run)
      ahead = turn.then(
        () => undefined,
        () => undefined,
      )
      return turn
    }
  }
  test('that never got its turn is refused at the deadline, and never runs after it', async () => {
    const inTurn = queue()
    const ran: string[] = []
    void inTurn(() => new Promise<void>((done) => setTimeout(done, 10_000)))
    const deadline = new AbortController()
    setTimeout(() => deadline.abort(), 3000)
    const queued = startsBefore(
      deadline.signal,
      () => new Error('late'),
      inTurn,
      () => Promise.resolve(ran.push('ran')),
    ).catch((error: unknown) => (error as Error).message)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await queued).toBe('late')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ran).toEqual([])
  })
  test('that began before the deadline answers for itself', async () => {
    const deadline = new AbortController()
    const begun = startsBefore(
      deadline.signal,
      () => new Error('late'),
      queue(),
      () => new Promise<string>((done) => setTimeout(() => done('its own answer'), 5000)),
    )
    await vi.advanceTimersByTimeAsync(1000)
    deadline.abort()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await begun).toBe('its own answer')
  })
})
