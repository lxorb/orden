// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'

/** Two windows of one desktop process on the crate, which holds one sync store at a time
 *  (sync_store.rs: `Stores(Mutex<Option<Held>>)`): opening another closes the one held,
 *  `sync_store_close` closes whatever is held, and reads and writes go to whatever is
 *  held. So one window at a time may run an engine, the one kept signed out as much as
 *  the account's, and no window closes a store it does not hold. */

const crate = vi.hoisted(() => ({
  held: null as null | { account: string; session: import('./store').SyncStore },
  mems: new Map<string, unknown>(),
  log: [] as string[],
  /** The account never answering: a try of the way back that hangs. */
  hang: false,
}))

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>()
  return {
    ...original,
    openSyncStore: async (id: string, _leads?: boolean, made?: string) => {
      const { MemoryStore } = await import('./memory-store')
      await new Promise((settle) => setTimeout(settle, 5))
      crate.log.push(`open ${id}`)
      if (crate.held?.account !== id) {
        if (crate.held) await crate.held.session.close()
        let mem = crate.mems.get(id) as InstanceType<typeof MemoryStore> | undefined
        if (!mem) {
          // A device id the hub takes: 32 hex digits, one per store.
          const device = Array.from(new TextEncoder().encode(id), (byte) => byte.toString(16)).join(
            '',
          )
          // A store made now takes the id it is given, as the crate's `open_as` does.
          mem = new MemoryStore(made ?? device.padEnd(32, '0'))
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
    // Read beside the store, as `sync_store_device` does: nothing opened, nothing marked.
    deviceOfSyncStore: (id: string) => {
      crate.log.push(`look ${id}`)
      const mem = crate.mems.get(id) as { device?: string } | undefined
      return Promise.resolve(mem?.device ?? null)
    },
    forgetSyncStore: (id: string) => {
      crate.log.push(`forget ${id}`)
      if (crate.held?.account === id) crate.held = null
      crate.mems.delete(id)
      return Promise.resolve()
    },
  }
})

vi.mock('./app-world', async () => {
  const { MemoryDisk } = await import('./memory-disk')
  return {
    appWorld: () => ({
      disk: new MemoryDisk(),
      account: { ask: () => (crate.hang ? new Promise(() => undefined) : Promise.resolve(null)) },
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

/** One lock holder at a time, shared by both windows. */
function locksOf() {
  const holders = new Set<string>()
  const waiting = new Map<string, (() => void)[]>()
  return {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => Promise<unknown>
      const options = (rest.length > 1 ? rest[0] : {}) as {
        signal?: AbortSignal
        ifAvailable?: boolean
      }
      if (options.ifAvailable && holders.has(name)) return Promise.resolve(run(null))
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
  const { workspace } = await import('../workspace.svelte')
  Object.assign(workspace, { spaces: [{ root: '/Notes', name: 'Notes' }] })
  const { runner } = await import('./runner.svelte')
  const { account } = await import('../account.svelte')
  return { runner, account }
}
type Window = Awaited<ReturnType<typeof aWindow>>

/** Signing in, heard by a window: what sync.svelte.ts does with it. */
function signIn(one: Window) {
  Object.assign(one.account, { user: { id: 'u1', syncVersion: 2 } })
  void one.runner.dropLocal()
  void one.runner.start()
}

const wrong = () => crate.log.filter((line) => line.startsWith('WRONG'))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
}))
vi.mock('./watching', () => ({
  watchFolders: () => ({
    stop: () => undefined,
    follow: () => undefined,
    caughtUp: () => undefined,
  }),
}))

// The way back's wait between tries, short: what a test of a start in that wait needs.
vi.mock('../backoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backoff')>()),
  pollDelay: () => 400,
}))

/** An account store this device already has, from an earlier session that quit cleanly. */
async function storeHere(id: string) {
  const { MemoryStore } = await import('./memory-store')
  const mem = new MemoryStore(deviceOfStore(id))
  crate.mems.set(id, mem)
  const session = mem.open()
  await session.cleanExit(true)
  await session.close()
  return mem
}

const opens = (id: string) => crate.log.filter((line) => line === `open ${id}`).length

/** The device id the crate's store of an account keeps, as this harness makes it. */
const deviceOfStore = (id: string) =>
  Array.from(new TextEncoder().encode(id), (byte) => byte.toString(16))
    .join('')
    .padEnd(32, '0')

beforeEach(() => {
  crate.held = null
  crate.mems.clear()
  crate.log.length = 0
  crate.hang = false
  Object.defineProperty(navigator, 'locks', { value: locksOf(), configurable: true })
})

describe('the hub asking the device id', () => {
  test('as the account signs in, before the engine kept signed out let go, the ids carry (M3-1)', async () => {
    const { MemoryStore } = await import('./memory-store')
    const { put, get } = await import('./store')
    const local = new MemoryStore('local')
    crate.mems.set('local', local)
    const id = '3c'.repeat(16)
    const seed = local.open()
    await seed.write([
      put('spaces', { space_id: 'local-1', root: '/Notes', cursor: 1, role: 'owner', store: null }),
      put('entries', {
        id,
        space_id: 'local-1',
        kind: 'note',
        parent: null,
        name: 'Plan.md',
        local_path: 'Plan.md',
        file_key: null,
        written_hash: null,
        mtime: null,
        size: null,
        seq: 1,
        deleted: false,
      }),
    ])
    await seed.close()

    await storeHere('u1')
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    const bHub = await import('./hub.svelte')
    void b.runner.startLocal()
    await settle()
    expect(crate.held?.account).toBe('local')

    // Signed in: B holds the hub's socket and asks its device id at once (hub.connect).
    Object.assign(b.account, { user: { id: 'u1', syncVersion: 2 } })
    const device = bHub.deviceId()
    await settle(20)
    signIn(a)
    signIn(b)
    await settle(200)

    const engine = a.runner.engine ?? b.runner.engine
    expect(engine).not.toBeNull()
    expect(await device).toBe(engine?.core.store.opened.device)
    expect(opens('u1')).toBe(1)
    const [row] = await engine!.core.store.read([get('meta', 'carried:/Notes')])
    expect(JSON.parse(String(row?.value))).toEqual({ 'Plan.md': id })
    expect(wrong()).toEqual([])
  })

  test('with no engine anywhere, it is the one the store of the account keeps', async () => {
    await storeHere('u1')
    const one = await aWindow()
    const hub = await import('./hub.svelte')
    Object.assign(one.account, { user: { id: 'u1', syncVersion: 1 } })
    expect(await hub.deviceId()).toBe(deviceOfStore('u1'))
    expect(crate.held).toBeNull()
    expect(opens('u1')).toBe(0)
  })
})

describe('the way back to v1', () => {
  test('waits for the window keeping the engine signed out, and opens no store under it (M3-2)', async () => {
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    void b.runner.startLocal()
    await settle()

    // Signed in to an account back on v1: every window drops the local engine and walks.
    Object.assign(b.account, { user: { id: 'u1', syncVersion: 1 }, token: 't' })
    const walked = b.runner.walkBack(() => true)
    await settle(200)
    expect(crate.log).not.toContain('open u1')
    expect(crate.held?.account).toBe('local')

    Object.assign(a.account, { user: { id: 'u1', syncVersion: 1 }, token: 't' })
    await a.runner.dropLocal()
    expect(await a.runner.walkBack(() => true)).toBe(true)
    expect(await walked).toBe(true)
    expect(wrong()).toEqual([])
  })
})

describe('a drop left waiting from a v1 sign-in', () => {
  test('signed out again, the window that takes the store over keeps its engine (M3-3)', async () => {
    const a = await aWindow()
    await a.runner.startLocal()
    const b = await aWindow()
    void b.runner.startLocal()
    await settle()
    // Signed in to an account still on v1: sync.svelte runs leaveLocal (dropLocal) and v1.
    for (const one of [a, b]) {
      Object.assign(one.account, { user: { id: 'u1', syncVersion: 1 } })
      void one.runner.dropLocal()
    }
    await settle()
    // Signed out: forgetWithSession asks signedOut only of a runner with accountNow.
    for (const one of [a, b]) {
      Object.assign(one.account, { user: null })
      if (one.runner.accountNow) await one.runner.signedOut('u1')
      void one.runner.startLocal()
    }
    await settle(1000)
    // A's window closes, and B takes the store over.
    await a.runner.stop()
    crate.log.length = 0
    await settle(1500)
    const kept = b.runner as unknown as { current: unknown; local: boolean }
    expect(kept.current).not.toBeNull()
    expect(kept.local).toBe(true)
    expect(crate.log).not.toContain('forget local')
  })
})

describe('who holds the device store, and for how long', () => {
  test('a start in the wait of the way back keeps the store the way back lets go of (M3F-1)', async () => {
    // No account to reach: a pass that asked would be signed out by its answer.
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    const a = await aWindow()
    let alive = true
    // The account back on v1 with no token: the way back cannot be walked, and waits.
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 1 }, token: null })
    const walked = a.runner.walkBack(() => alive)
    await settle(100)
    // The account on v2 again: the session that walked is over, and the engine starts.
    alive = false
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
    void a.runner.start()
    expect(await walked).toBe(false)
    await settle(300)
    expect(a.runner.engine).not.toBeNull()
    expect((a.runner as unknown as { storeLead: unknown }).storeLead).not.toBeNull()

    // Another window asks the device id: answered, and the engine's store stays open.
    const b = await aWindow()
    const bHub = await import('./hub.svelte')
    Object.assign(b.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
    void b.runner.start()
    expect(await bHub.deviceId()).toBe(a.runner.engine?.core.store.opened.device)
    expect(crate.held?.account).toBe('u1')
    expect(wrong()).toEqual([])
  }, 20_000)

  test('a v1 session has the device id of the store at once, in the window that dropped the local engine and in another (M3F-2)', async () => {
    vi.useFakeTimers()
    try {
      await storeHere('u1')
      const a = await aWindow()
      const aHub = await import('./hub.svelte')
      Object.assign(a.account, { user: { id: 'u1', syncVersion: 1 } })
      // sync.start() leaves the local engine on every launch: `leaveLocal` -> `dropLocal`.
      const dropped = a.runner.dropLocal()
      await vi.advanceTimersByTimeAsync(100)
      await dropped

      const asked: (string | undefined)[] = [undefined, undefined]
      void aHub.deviceId().then((id) => (asked[0] = id))
      await vi.advanceTimersByTimeAsync(100)
      expect(asked[0]).toBe(deviceOfStore('u1'))

      const b = await aWindow()
      const bHub = await import('./hub.svelte')
      Object.assign(b.account, { user: { id: 'u1', syncVersion: 1 } })
      void bHub.deviceId().then((id) => (asked[1] = id))
      await vi.advanceTimersByTimeAsync(100)
      expect(asked[1]).toBe(deviceOfStore('u1'))
      expect(wrong()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the device id read beside the store', () => {
  test('asked at launch, before the engine opens the store, leaves a clean quit clean (S-2)', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    await storeHere('u1')
    const a = await aWindow()
    const hub = await import('./hub.svelte')
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
    const device = hub.deviceId()
    await settle(100)
    signIn(a)
    await settle(300)
    expect(await device).toBe(deviceOfStore('u1'))
    expect(a.runner.engine?.core.store.opened.wasClean).toBe(true)
    expect(opens('u1')).toBe(1)
  })

  test('answers at once in the window walking back while a try hangs, and in another (S-3)', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    crate.hang = true
    const mem = await storeHere('u1')
    const { put } = await import('./store')
    const kept = mem.open()
    await kept.write([
      put('spaces', { space_id: 's1', root: '/Notes', cursor: 1, role: 'owner', store: null }),
      put('meta', { key: 'first:s1', value: '1' }),
    ])
    await kept.cleanExit(true)
    await kept.close()

    const a = await aWindow()
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 1 }, token: 't' })
    void a.runner.walkBack(() => true)
    await settle(200)
    const b = await aWindow()
    Object.assign(b.account, { user: { id: 'u1', syncVersion: 1 }, token: 't' })
    const asked = await Promise.race([
      Promise.all([a.runner.deviceOf('u1'), b.runner.deviceOf('u1')]),
      settle(100).then(() => 'late'),
    ])
    expect(asked).toEqual([deviceOfStore('u1'), deviceOfStore('u1')])
  })
})

describe('a start that a stop and a start overtake', () => {
  for (const gap of [0, 1, 3, 6, 12, 30]) {
    test(`leaves one engine, and a stop lets go of everything (S-1, ${gap} ms)`, async () => {
      vi.stubGlobal('fetch', () => new Promise(() => undefined))
      const a = await aWindow()
      Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
      void a.runner.start()
      if (gap) await settle(gap)
      void a.runner.stop()
      void a.runner.start()
      await settle(300)
      const b = await aWindow()
      Object.assign(b.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
      void b.runner.start()
      await settle(300)
      expect(a.runner.engine ?? b.runner.engine).not.toBeNull()
      await a.runner.stop()
      await settle(50)
      const held = a.runner as unknown as { storeLead: unknown; lead: unknown }
      expect(held.storeLead).toBeNull()
      expect(held.lead).toBeNull()
      expect(wrong()).toEqual([])
    })
  }
})

describe('one id for a device and an account', () => {
  test('signed in with no store yet, the hub has the id the store then takes (DEV-1)', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    const a = await aWindow()
    const hub = await import('./hub.svelte')
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
    const before = await hub.deviceId()
    signIn(a)
    await settle(300)
    expect(a.runner.engine?.core.store.opened.device).toBe(before)
    expect(await hub.deviceId()).toBe(before)
  })

  test('a store that has an id keeps it, and another account is another device', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    await storeHere('u1')
    const a = await aWindow()
    const hub = await import('./hub.svelte')
    Object.assign(a.account, { user: { id: 'u1', syncVersion: 2 }, token: 't' })
    signIn(a)
    await settle(300)
    expect(a.runner.engine?.core.store.opened.device).toBe(deviceOfStore('u1'))
    expect(await hub.deviceId()).toBe(deviceOfStore('u1'))
    Object.assign(a.account, { user: { id: 'u2', syncVersion: 1 } })
    const other = await hub.deviceId()
    Object.assign(a.account, { user: { id: 'u3', syncVersion: 1 } })
    expect(await hub.deviceId()).not.toBe(other)
  })
})
