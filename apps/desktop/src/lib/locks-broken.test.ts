import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { leadSync } from './sync-client/src/lead'
import { heldForLife, holdIfFree, ifFree, inTurn, locksWork } from './locks'
import { aloneHere } from './sync-client/src/budget'
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
    heldForLife('orden:test', run)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('a name is free to claim', async () => {
    const held = holdIfFree('orden:test')
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

  test("a kept space's index is written, once", async () => {
    const run = vi.fn(() => Promise.resolve('index'))
    const written = inTurn(() => 'orden:internal:space', run, 10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await written).toBe('index')
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('the sync pass hears whether the window is alone', async () => {
    const alone = aloneHere()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(typeof (await alone)).toBe('boolean')
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
      locks: {
        request: (_name: string, ...rest: unknown[]) =>
          Promise.resolve((rest.at(-1) as (lock: unknown) => unknown)({})),
      },
    })
    await expect(
      oneWriteAt('/a.md', () => {
        throw new Error('refused')
      }),
    ).rejects.toThrow('refused')
  })

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

  test('a turn another window never gives up is taken once its patience is out', async () => {
    let free = true
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, ...rest: unknown[]) => {
          const run = rest.at(-1) as (lock: unknown) => unknown
          const { ifAvailable } = (rest.length > 1 ? rest[0] : {}) as { ifAvailable?: boolean }
          if (ifAvailable) return Promise.resolve(run(free ? {} : null))
          free = false
          return new Promise(() => undefined)
        },
      },
    })
    const run = vi.fn(() => Promise.resolve('index'))
    const written = inTurn(() => 'orden:internal:space', run, 10_000)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await written).toBe('index')
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('a name one window holds is not free to the next, until it lets go', async () => {
    vi.stubGlobal('navigator', { locks: working() })
    const first = await holdIfFree('orden:claim:/s/Plan.md')
    expect(first).toBeTypeOf('function')
    expect(await holdIfFree('orden:claim:/s/Plan.md')).toBeNull()
    expect(await holdIfFree('orden:claim:/s/Other.md')).toBeTypeOf('function')
    first?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(await holdIfFree('orden:claim:/s/Plan.md')).toBeTypeOf('function')
  })
})

describe('a main thread busy past the timer', () => {
  function slow(late: number): LockManager {
    return {
      request: (_name: string, ...rest: unknown[]) => {
        const run = rest.at(-1) as (lock: unknown) => unknown
        return new Promise((resolve) => setTimeout(() => resolve(run({})), late))
      },
    } as unknown as LockManager
  }

  test('the timer gives an answer on its way a moment more', async () => {
    const answer = locksWork(slow(2_001))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await answer).toBe(true)
  })

  test('a free lock too', async () => {
    const answer = ifFree(slow(2_001), 'orden:window:1', () => Promise.resolve())
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await answer).toBe('held')
  })

  test('an answer later than that still counts from then on', async () => {
    const locks = slow(4_000)
    const first = locksWork(locks)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(await first).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await locksWork(locks)).toBe(true)
  })

  test('what leads for good waits in line where locks only looked broken', async () => {
    const locks = slow(4_000)
    vi.stubGlobal('navigator', { locks })
    const requested = vi.spyOn(locks, 'request')
    const run = vi.fn(() => new Promise<void>(() => undefined))
    heldForLife('orden:hub', run)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requested.mock.calls.some(([name]) => name === 'orden:hub')).toBe(true)
  })
})

describe('locks that never answer and many files', () => {
  test('each file does not wait its own three seconds', async () => {
    vi.stubGlobal('navigator', { locks: { request: () => new Promise(() => undefined) } })
    let wrote = 0
    const all = (async () => {
      for (let one = 0; one < 8; one += 1) {
        await oneWriteAt(`/${String(one)}.md`, () => Promise.resolve((wrote += 1)))
      }
    })()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(wrote).toBe(8)
    await all
  })

  test('two spellings of one file are one turn', async () => {
    const names: string[] = []
    vi.stubGlobal('navigator', {
      locks: {
        request: (name: string, ...rest: unknown[]) => {
          names.push(name)
          return Promise.resolve((rest.at(-1) as (lock: unknown) => unknown)({ name }))
        },
      },
    })
    await oneWriteAt('/s/a.md', () => Promise.resolve())
    await oneWriteAt('/s//a.md', () => Promise.resolve())
    const files = names.filter((name) => name.startsWith('orden:file:'))
    expect(files[0]).toBe(files[1])
  })
})
