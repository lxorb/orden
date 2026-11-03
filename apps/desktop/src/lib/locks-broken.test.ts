/** Web Locks that are not there, that refuse, or that never answer must leave one window
 *  working: every use of them, the session's slot, the engine's election and a file's turn. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { leadSync } from './sync2/lead'
import { oneWriteAt } from './windows'
import { takeSlot } from './workspace/slot'

const BROKEN = {
  missing: undefined,
  refusing: {
    request: () => Promise.reject(new DOMException('denied', 'SecurityError')),
    query: () => Promise.reject(new DOMException('denied', 'SecurityError')),
  },
  throwing: {
    request: () => {
      throw new DOMException('denied', 'SecurityError')
    },
    query: () => Promise.resolve({ held: [], pending: [] }),
  },
  hanging: {
    request: () => new Promise(() => undefined),
    query: () => new Promise(() => undefined),
  },
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(Object.entries(BROKEN))('with locks %s', (_name, locks) => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { locks })
  })

  test('the window takes the first session', async () => {
    const taken = takeSlot()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await taken).toBe(0)
  })

  test('the window leads', async () => {
    const led = leadSync()
    await vi.advanceTimersByTimeAsync(10_000)
    const lead = await led
    expect(lead).not.toBeNull()
    lead?.release()
  })

  test('the file is written, once', async () => {
    const run = vi.fn(() => Promise.resolve('words'))
    const written = oneWriteAt('/a.md', run)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await written).toBe('words')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
