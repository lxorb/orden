import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { arriving } from './arriving.svelte'

/** The surface an account's first sync holds, on its own. What raises it is the
 *  loop next door and is covered in sync.test.ts; this is the state machine:
 *  waiting, counting, done, and the way out that keeps a bad connection from
 *  being a trap. */

beforeEach(() => {
  vi.useFakeTimers()
  arriving.reset()
})

afterEach(() => {
  arriving.reset()
  vi.useRealTimers()
})

describe('waiting for the account', () => {
  test('is not up until something says so', () => {
    expect(arriving.showing).toBe(false)
  })

  test('goes up before the pass knows how much is coming', () => {
    arriving.begin()

    expect(arriving.showing).toBe(true)
    // Null rather than nought: the state says a word while the number is
    // unknown, and "0 of 0" would be a lie about a pass that has not asked yet.
    expect(arriving.total).toBe(null)
    expect(arriving.done).toBe(0)
  })

  test('takes the count once the pass has asked', () => {
    arriving.begin()
    arriving.expect(340)

    expect(arriving.total).toBe(340)
    expect(arriving.showing).toBe(true)
  })

  test('counts every note that lands', () => {
    arriving.begin()
    arriving.expect(3)
    arriving.arrived()
    arriving.arrived()

    expect(arriving.done).toBe(2)
  })

  test('goes at once when nothing is coming', () => {
    arriving.begin()
    arriving.expect(0)

    expect(arriving.showing).toBe(false)
  })

  test('goes when the pass ends', () => {
    arriving.begin()
    arriving.expect(2)
    arriving.arrived()
    arriving.settled()

    expect(arriving.showing).toBe(false)
  })
})

describe('a pass nobody is waiting on', () => {
  test('says nothing, whatever it reports', () => {
    arriving.expect(500)
    arriving.arrived()
    arriving.settled()

    expect(arriving.showing).toBe(false)
    // And nothing was counted either: a later pass is the sync light's business.
    expect(arriving.done).toBe(0)
    expect(arriving.total).toBe(null)
  })
})

describe('the way out', () => {
  test('is not offered while notes are still landing', () => {
    arriving.begin()
    arriving.expect(400)

    // Slower than the patience, but moving the whole way.
    for (let landed = 0; landed < 4; landed++) {
      vi.advanceTimersByTime(5000)
      arriving.arrived()
      expect(arriving.stuck).toBe(false)
    }

    expect(arriving.showing).toBe(true)
  })

  test('is offered once nothing has arrived for a while', () => {
    arriving.begin()
    arriving.expect(400)

    vi.advanceTimersByTime(6000)

    expect(arriving.stuck).toBe(true)
    // Offered, not taken: what is on its way may still land.
    expect(arriving.showing).toBe(true)
  })

  test('lets go of the app when it is taken', () => {
    arriving.begin()
    arriving.expect(400)
    vi.advanceTimersByTime(6000)
    arriving.giveUp()

    expect(arriving.showing).toBe(false)
    expect(arriving.stuck).toBe(false)
  })

  test('is withdrawn by a note that arrives late', () => {
    arriving.begin()
    arriving.expect(400)
    vi.advanceTimersByTime(6000)
    expect(arriving.stuck).toBe(true)

    arriving.arrived()

    expect(arriving.stuck).toBe(false)
  })
})

describe('signing out', () => {
  test('takes the state down and forgets the count', () => {
    arriving.begin()
    arriving.expect(340)
    arriving.arrived()
    arriving.reset()

    expect(arriving.showing).toBe(false)
    expect(arriving.done).toBe(0)
    expect(arriving.total).toBe(null)
  })

  test('stops the way out from appearing behind it', () => {
    arriving.begin()
    arriving.reset()

    vi.advanceTimersByTime(60_000)

    expect(arriving.stuck).toBe(false)
    expect(arriving.showing).toBe(false)
  })
})
