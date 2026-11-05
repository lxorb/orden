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
          // A device id the hub takes: 32 hex digits, one per store.
          const device = [...id].map((one) => one.charCodeAt(0).toString(16)).join('')
          mem = new MemoryStore(device.padEnd(32, '0'))
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

/** Signing out, heard by a window: what account.svelte.ts and sync.svelte.ts do. */
async function signOut(one: Window) {
  Object.assign(one.account, { user: null })
  await one.runner.signedOut('u1')
  void one.runner.startLocal()
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

beforeEach(() => {
  crate.held = null
  crate.mems.clear()
  crate.log.length = 0
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
    const [row] = await engine!.core.store.read([get('meta', 'carried:/Notes')])
    expect(JSON.parse(String(row?.value))).toEqual({ 'Plan.md': id })
    expect(wrong()).toEqual([])
  })

  test('with no engine anywhere, it is the one the store of the account keeps', async () => {
    const one = await aWindow()
    const hub = await import('./hub.svelte')
    Object.assign(one.account, { user: { id: 'u1', syncVersion: 1 } })
    const device = await hub.deviceId()
    const { MemoryStore } = await import('./memory-store')
    const store = crate.mems.get('u1') as InstanceType<typeof MemoryStore>
    expect(device).toBe(store.open().opened.device)
    expect(crate.held).toBeNull()
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
