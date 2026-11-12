// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core'
const crate = vi.hoisted(() => ({
  held: null as null | { account: string; session: import('./store').SyncStore },
  mems: new Map<string, unknown>(),
  log: [] as string[],
}))

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>()
  return {
    ...original,
    openSyncStore: async (id: string) => {
      const { MemoryStore } = await import('./memory-store')
      await new Promise((settle) => setTimeout(settle, 5))
      crate.log.push(`open ${id}`)
      if (crate.held?.account !== id) {
        if (crate.held) await crate.held.session.close()
        let mem = crate.mems.get(id) as InstanceType<typeof MemoryStore> | undefined
        if (!mem) {
          mem = new MemoryStore(id)
          crate.mems.set(id, mem)
        }
        crate.held = { account: id, session: mem.open() }
      }
      const opened = crate.held.session.opened
      const now = () => {
        if (!crate.held) throw new original.StoreError('no sync store is open')
        if (crate.held.account !== id) crate.log.push(`WRONG ${id}-engine on ${crate.held.account}`)
        return crate.held
      }
      return {
        opened,
        read: (q: never) => now().session.read(q),
        write: (c: never) => now().session.write(c),
        cleanExit: (clean: boolean) => now().session.cleanExit(clean),
        close: async () => {
          if (crate.held && crate.held.account !== id) {
            crate.log.push(`WRONG close by ${id}-engine of ${crate.held.account}`)
          }
          crate.log.push(`close ${id}`)
          if (crate.held) await crate.held.session.close()
          crate.held = null
        },
      }
    },
    forgetSyncStore: (id: string) => {
      crate.log.push(`forget ${id}`)
      if (crate.held?.account === id) crate.held = null
      return Promise.resolve()
    },
  }
})

vi.mock('./app-world', async () => {
  const { MemoryDisk } = await import('./memory-disk')
  return {
    appWorld: () => ({
      disk: new MemoryDisk(),
      account: { ask: () => Promise.resolve(null) },
      name: 'here',
      now: () => 1000,
      random: Math.random,
      digest: (text: string) => Promise.resolve(String(hash32('a', text))),
      join: (root: string, path: string) => `${root}/${path}`,
      foldsCase: true,
      platform: 'other',
    }),
  }
})

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
  const holders = new Set<string>()
  const waiting = new Map<string, (() => void)[]>()
  return {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => Promise<unknown>
      const options = (rest.length > 1 ? rest[0] : {}) as { signal?: AbortSignal }
      return new Promise((resolve, reject) => {
        const go = () => {
          holders.add(name)
          void Promise.resolve(run({ name })).then((value) => {
            holders.delete(name)
            waiting.get(name)?.shift()?.()
            resolve(value)
          })
        }
        if (!holders.has(name)) {
          go()
          return
        }
        const queue = waiting.get(name) ?? []
        waiting.set(name, queue)
        queue.push(go)
        options.signal?.addEventListener('abort', () => {
          const at = queue.indexOf(go)
          if (at < 0) return
          queue.splice(at, 1)
          reject(new DOMException('gave up', 'AbortError'))
        })
      })
    },
    query: () => Promise.resolve({ held: [], pending: [] }),
  } as unknown as LockManager
}

const settle = (ms = 50) => new Promise((done) => setTimeout(done, ms))

async function aWindow() {
  vi.resetModules()
  await import('../../sync-ports')
  const { runner } = await import('./runner.svelte')
  const { account } = await import('../../account.svelte')
  return { runner, account }
}
type Window = Awaited<ReturnType<typeof aWindow>>

function signIn(one: Window) {
  Object.assign(one.account, { user: { id: 'u1', syncVersion: 2 } })
  void one.runner.dropLocal()
  void one.runner.start()
}

async function signOut(one: Window) {
  Object.assign(one.account, { user: null })
  await one.runner.signedOut('u1')
  void one.runner.startLocal()
}

const wrong = () => crate.log.filter((line) => line.startsWith('WRONG'))

beforeEach(() => {
  crate.held = null
  crate.mems.clear()
  crate.log.length = 0
  Object.defineProperty(navigator, 'locks', { value: locksOf(), configurable: true })
})

describe('two windows on one crate store', () => {
  test('a follower signing in leaves the leader its account store', async () => {
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    void b.runner.startLocal()
    await settle()
    expect(crate.held?.account).toBe('local')

    Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 } })
    await Promise.all([a.runner.start(), a.runner.dropLocal()])
    expect(a.runner.engine).not.toBeNull()
    expect(crate.held?.account).toBe('u1')

    signIn(b)
    await settle()

    expect(crate.held?.account).toBe('u1')
    expect(b.runner.engine).toBeNull()
    expect(wrong()).toEqual([])
  })

  test('signed out, one window keeps the engine, and the next takes it when it goes', async () => {
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    void b.runner.startLocal()
    await settle()
    expect(crate.log.filter((line) => line === 'open local')).toHaveLength(1)

    await a.runner.stop()
    await settle()
    expect(crate.held?.account).toBe('local')
    expect(crate.log.filter((line) => line === 'open local')).toHaveLength(2)
    expect(wrong()).toEqual([])
  })

  test('signing in in the window without the engine moves it to the account in the one with it', async () => {
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    void b.runner.startLocal()
    await settle()

    signIn(b)
    await settle()
    signIn(a)
    await settle()

    expect(crate.held?.account).toBe('u1')
    expect(a.runner.engine).not.toBeNull()
    expect(b.runner.engine).toBeNull()
    expect(wrong()).toEqual([])
  })

  test('signing out in either window leaves one engine kept signed out', async () => {
    for (const first of ['leader', 'follower'] as const) {
      crate.log.length = 0
      const a = await aWindow()
      await a.runner.startLocal()
      const b = await aWindow()
      void b.runner.startLocal()
      await settle()
      signIn(a)
      signIn(b)
      await settle()
      expect(crate.held?.account).toBe('u1')

      const [one, two] = first === 'leader' ? [a, b] : [b, a]
      const from = crate.log.length
      const leaving = signOut(one)
      await settle(5)
      await Promise.all([leaving, signOut(two)])
      await settle()

      expect(crate.held?.account).toBe('local')
      expect(crate.log.slice(from).filter((line) => line === 'open local')).toHaveLength(1)
      expect(wrong()).toEqual([])
      await a.runner.stop()
      await b.runner.stop()
      await settle()
    }
  })
})
