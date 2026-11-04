/** Web Locks that are not there, that refuse, or that never answer must leave one window
 *  working: every use of them, the session's slot, the engine's election and a file's turn. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { leadSync } from './sync2/lead'
import { heldForLife, holdIfFree } from './locks'
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

  test('what is held for the life of a window runs all the same', async () => {
    const run = vi.fn(() => new Promise<void>(() => undefined))
    heldForLife('nib:test', run)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('a name is free to claim', async () => {
    const held = holdIfFree('nib:test')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await held).toBeTypeOf('function')
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

describe('with locks that work', () => {
  test('a turn whose work throws at once is refused, and is over', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: (_name: string, run: () => unknown) => Promise.resolve(run()) },
    })
    await expect(
      oneWriteAt('/a.md', () => {
        throw new Error('refused')
      }),
    ).rejects.toThrow('refused')
  })

  /** One holder per name, the way the browser's are, and nobody waits. */
  function working(): LockManager {
    const holders = new Set<string>()
    return {
      request: async (name: string, ...rest: unknown[]) => {
        const run = rest.at(-1) as (lock: unknown) => unknown
        const { ifAvailable } = (rest.length > 1 ? rest[0] : {}) as { ifAvailable?: boolean }
        if (ifAvailable && holders.has(name)) return run(null)
        holders.add(name)
        try {
          return await run({ name })
        } finally {
          holders.delete(name)
        }
      },
    } as unknown as LockManager
  }

  test('a name one window holds is not free to the next, until it lets go', async () => {
    vi.stubGlobal('navigator', { locks: working() })
    const first = await holdIfFree('nib:claim:/s/Plan.md')
    expect(first).toBeTypeOf('function')
    expect(await holdIfFree('nib:claim:/s/Plan.md')).toBeNull()
    expect(await holdIfFree('nib:claim:/s/Other.md')).toBeTypeOf('function')
    first?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(await holdIfFree('nib:claim:/s/Plan.md')).toBeTypeOf('function')
  })
})
