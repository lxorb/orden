import '../../sync-ports'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Said } from '../../platform/src/windows'

vi.mock('../../platform/src/windows', async (original) => {
  const real = await original<typeof import('../../platform/src/windows')>()
  const ends: { onmessage: ((event: MessageEvent<unknown>) => void) | null }[] = []
  const end = () => {
    const line = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: (message: unknown) => {
        for (const one of ends) {
          if (one !== line) one.onmessage?.({ data: message } as MessageEvent<unknown>)
        }
      },
    }
    ends.push(line)
    return line
  }
  const [mine, theirs] = [end(), end()]
  return { ...real, windows: new real.Windows(() => mine), other: new real.Windows(() => theirs) }
})

const opening = vi.hoisted(() => ({
  open: (_account: string): Promise<unknown> => Promise.reject(new Error('the store refused')),
  forgotten: [] as string[],
}))
vi.mock('./store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store')>()),
  openSyncStore: (account: string) => opening.open(account),
  forgetSyncStore: (account: string) => {
    opening.forgotten.push(account)
    return Promise.resolve()
  },
}))

const leaving = vi.hoisted(() => ({ asked: 0 }))
vi.mock('./left', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./left')>()),
  leaveUnsent: () => {
    leaving.asked += 1
    return Promise.resolve(false)
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

function locksOf() {
  const holders = new Map<string, boolean>()
  const waiting = new Map<string, (() => void)[]>()
  const release = (name: string) => {
    holders.delete(name)
    waiting.get(name)?.shift()?.()
  }
  const manager = {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => Promise<unknown> | undefined
      const options = (rest.length > 1 ? rest[0] : {}) as {
        ifAvailable?: boolean
        signal?: AbortSignal
      }
      if (options.ifAvailable && holders.get(name)) return Promise.resolve(run(null))
      return new Promise((resolve, reject) => {
        const go = () => {
          holders.set(name, true)
          void Promise.resolve(run({ name })).then((value) => {
            release(name)
            resolve(value)
          })
        }
        if (!holders.get(name)) {
          go()
          return
        }
        const queue = waiting.get(name) ?? []
        waiting.set(name, queue)
        queue.push(go)
        options.signal?.addEventListener('abort', () => {
          queue.splice(queue.indexOf(go), 1)
          reject(new DOMException('gave up', 'AbortError'))
        })
      })
    },
  } as unknown as LockManager
  return {
    manager,
    busy: (name: string) => holders.set(name, true),
    free: release,
  }
}

const { other, windows } = (await import('../../platform/src/windows')) as unknown as {
  other: import('../../platform/src/windows').Windows
  windows: import('../../platform/src/windows').Windows
}
const { runner } = await import('./runner.svelte')
const { account } = await import('../../accounts/src/account.svelte')

const flush = async () => {
  for (let at = 0; at < 30; at += 1) await Promise.resolve()
}

const signedInAs = (id: string) => {
  account.user = { id } as never
}

let locks: ReturnType<typeof locksOf>
const stops: (() => void)[] = []
const heardByOther = (kind: string) => {
  const heard: Said[] = []
  stops.push(other.hear(kind, (said) => heard.push(said)))
  return heard
}

beforeEach(() => {
  locks = locksOf()
  vi.stubGlobal('navigator', { locks: locks.manager })
  opening.forgotten.length = 0
  opening.open = () => Promise.reject(new Error('the store refused'))
})

afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  await runner.stop()
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('a window with no engine and nobody who has one', () => {
  test('after an engine that would not start, a pass answers at once and nothing is owed', async () => {
    signedInAs('a')
    await runner.start().catch(() => undefined)
    let answer: boolean | undefined
    void runner.passNow().then((said) => (answer = said))
    await flush()
    expect(answer).toBe(false)

    const owed = heardByOther('sync-owed')
    await runner.wrote('/s/a.md', 'words')
    expect(owed).toEqual([])
  })

  test('while its own engine is starting, too', async () => {
    signedInAs('a')
    let refuse: () => void = () => undefined
    opening.open = () =>
      new Promise((_, reject) => (refuse = () => reject(new Error('the store refused'))))
    const starting = runner.start().catch(() => undefined)
    await flush()
    let answer: boolean | undefined
    void runner.passNow().then((said) => (answer = said))
    await flush()
    expect(answer).toBe(false)
    refuse()
    await starting
  })
})

describe('what a window owes', () => {
  test('is bounded, and one note is owed once', async () => {
    signedInAs('a')
    locks.busy('orden-sync:a')
    void runner.start()
    await flush()
    const held = runner as unknown as { owed: { size: number } }

    for (let at = 0; at < 5; at += 1) await runner.wrote('/s/one.md', `words ${String(at)}`)
    expect(held.owed.size).toBe(1)
    for (let at = 0; at < 5_000; at += 1) await runner.wrote(`/s/${String(at)}.md`, 'x')
    expect(held.owed.size).toBeLessThanOrEqual(1_000)
  })

  test('goes with the account: nothing of A is said once B is here', async () => {
    signedInAs('a')
    locks.busy('orden-sync:a')
    locks.busy('orden-sync:b')
    void runner.start()
    await flush()
    await runner.wrote('/s/secret.md', 'words of A')
    await runner.stop()

    signedInAs('b')
    void runner.start()
    await flush()
    const owed = heardByOther('sync-owed')
    other.say('sync-leader', { account: 'b' })
    await flush()
    expect(owed).toEqual([])
    other.say('sync-leader', { account: 'a' })
    await flush()
    expect(owed).toEqual([])
  })
})

describe('the engine’s window', () => {
  const engine = () => ({
    core: { spaces: new Map(), store: { close: () => Promise.resolve() } },
    saved: vi.fn(() => Promise.resolve()),
    entryAt: () => null,
    awayFiles: () => [],
    quit: () => Promise.resolve(),
    stop: () => undefined,
  })

  test('takes what its own account owes and nothing of another’s', async () => {
    signedInAs('b')
    const held = runner as unknown as {
      accountId: string | null
      current: unknown
      tookOver(one: unknown): Promise<void>
    }
    held.accountId = 'b'
    const one = engine()
    held.current = one
    await held.tookOver(one)
    const item = (text: string) => ({ id: '0', what: { kind: 'wrote', path: '/s/a.md', text } })

    other.say('sync-owed', { account: 'a', item: item('words of A') })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(one.saved).not.toHaveBeenCalled()

    other.say('sync-owed', { account: 'b', item: item('words of B') })
    await vi.waitFor(() => expect(one.saved).toHaveBeenCalledTimes(1))
  })

  test('on a follower, focus and a visible window’s beat reach it', async () => {
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: () => undefined,
    })
    vi.stubGlobal('document', {
      hidden: false,
      visibilityState: 'visible',
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: () => undefined,
    })
    vi.useFakeTimers()
    try {
      signedInAs('a')
      locks.busy('orden-sync:a')
      void runner.start()
      await flush()
      other.say('sync-leader', { account: 'a' })
      await flush()
      const kicks = heardByOther('sync-kick')

      listeners.get('focus')?.()
      expect(kicks).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(kicks).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('signing out in a window with no engine', () => {
  test('tells nothing to delete under the engine: the store goes once its window let go', async () => {
    signedInAs('a')
    locks.busy('orden-sync:local')
    locks.busy('orden-sync:a')
    void runner.start()
    await flush()

    const leaving = runner.signedOut('a')
    await flush()
    expect(opening.forgotten).toEqual([])

    locks.free('orden-sync:a')
    locks.free('orden-sync:local')
    await leaving
    expect(opening.forgotten).toEqual(['a'])
    expect(windows).toBeDefined()
  })
})

describe('signing out, asked, in a window with no engine', () => {
  const leader = (unsent: boolean) => {
    stops.push(
      other.hear('sync-ask', (said) => {
        const value = said.what === 'unsent' ? unsent : said.what === 'pass' ? true : null
        other.say('sync-said', { account: 'a', id: said.id, to: windows.me, value })
      }),
    )
  }

  for (const unsent of [true, false]) {
    test(`asks the engine's window, and asks the reader only when changes are unsent (${String(unsent)})`, async () => {
      leaving.asked = 0
      signedInAs('a')
      locks.busy('orden-sync:a')
      void runner.start()
      await flush()
      other.say('sync-leader', { account: 'a' })
      await flush()
      leader(unsent)

      const left = await runner.sentBeforeLeaving()

      expect(leaving.asked).toBe(unsent ? 1 : 0)
      expect(left).toBe(!unsent)
    })
  }
})
