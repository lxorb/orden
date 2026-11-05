// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'

/** The engine kept signed out and the account's, one after the other (#1068, step 4b):
 *  the crate keeps one sync store open at a time and closes whichever that is, so the
 *  account's engine opens its store only once the one kept signed out has closed its
 *  own, and signing in lets the store kept signed out go. */

const said = vi.hoisted(() => [] as string[])
/** Each store by whose it is, kept across opens as the crate keeps its files. */
const stores = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>()
  return {
    ...original,
    openSyncStore: async (id: string) => {
      said.push(`open ${id}`)
      // Fetched here, not as the mock is made: the memory store reads this module.
      const { MemoryStore } = await import('./memory-store')
      // A round trip, as the crate's is.
      await new Promise((settle) => setTimeout(settle, 5))
      const kept =
        (stores.get(id) as InstanceType<typeof MemoryStore> | undefined) ?? new MemoryStore(id)
      stores.set(id, kept)
      const store = kept.open()
      return {
        ...store,
        close: () => {
          said.push(`close ${id}`)
          return store.close()
        },
      }
    },
    forgetSyncStore: (id: string) => {
      said.push(`forget ${id}`)
      stores.delete(id)
      return Promise.resolve()
    },
  }
})

// As on the desktop, the one place spaces are kept signed out, with no folder to watch.
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
}))
vi.mock('./watching', () => ({
  watchFolders: () => ({ stop: () => undefined, follow: () => undefined }),
}))

const { MemoryDisk } = await import('./memory-disk')
vi.mock('./app-world', () => {
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

const { runner } = await import('./runner.svelte')
const { account } = await import('../account.svelte')

describe('the engine kept signed out', () => {
  test('is nobody’s to ask about, and lets go of its store before the account’s opens', async () => {
    await runner.startLocal()
    expect(said).toEqual(['open local'])
    // What asks the account about an entry reads no ids off it.
    expect(runner.engine).toBeNull()

    Object.assign(account, { user: { id: 'u1', syncVersion: 2 } })
    const starting = runner.start()
    const dropping = runner.dropLocal()
    await Promise.all([starting, dropping])

    // The account's store opens once this window leads, which may come after the drop,
    // and never before the store kept signed out has gone.
    expect(said.slice(0, 2)).toEqual(['open local', 'close local'])
    expect(said).toContain('open u1')
    expect(said.lastIndexOf('forget local')).toBeLessThan(said.indexOf('open u1'))
    expect(said).toContain('forget local')
    expect(said).not.toContain('close u1')
    expect(runner.engine).not.toBeNull()

    await runner.stop()
    Object.assign(account, { user: null })
  })

  test('does not start while somebody is signed in', async () => {
    said.length = 0
    Object.assign(account, { user: { id: 'u1', syncVersion: 2 } })
    await runner.startLocal()
    expect(said).toEqual([])
    Object.assign(account, { user: null })
  })

  test('carries the ids of what it kept into the account’s store, for each space’s first pass', async () => {
    said.length = 0
    const { MemoryStore } = await import('./memory-store')
    const { put, get } = await import('./store')
    const local = new MemoryStore('local')
    stores.set('local', local)
    const id = '3c'.repeat(16)
    await local.open().write([
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

    Object.assign(account, { user: { id: 'u2', syncVersion: 2 } })
    await Promise.all([runner.dropLocal(), runner.start()])

    expect(said).toContain('forget local')
    expect(stores.has('local')).toBe(false)
    const [row] = await runner.engine!.core.store.read([get('meta', 'carried:/Notes')])
    expect(JSON.parse(String(row?.value))).toEqual({ 'Plan.md': id })
    await runner.stop()
    Object.assign(account, { user: null })
  })

  test('is handed the ids of what the account kept, signing out, and which account they came from', async () => {
    said.length = 0
    const { MemoryStore } = await import('./memory-store')
    const { put, get } = await import('./store')
    const kept = new MemoryStore('u3')
    stores.set('u3', kept)
    const id = '5f0c1d7e-2b8a-4c1e-9d3f-0a1b2c3d4e5f'
    await kept.open().write([
      put('spaces', { space_id: 's3', root: '/Notes', cursor: 1, role: 'owner', store: null }),
      put('entries', {
        id,
        space_id: 's3',
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
    Object.assign(account, { user: { id: 'u3', syncVersion: 2 } })
    await runner.start()

    await runner.signedOut('u3')
    Object.assign(account, { user: null })
    await runner.startLocal()

    const local = stores.get('local') as InstanceType<typeof MemoryStore>
    const [ids, from] = await local
      .open()
      .read([get('meta', 'carried:/Notes'), get('meta', 'from:/Notes')])
    expect(JSON.parse(String(ids?.value))).toEqual({ 'Plan.md': id })
    expect(JSON.parse(String(from?.value))).toEqual({ account: 'u3', ids: [id] })
    await runner.stop()
  })
})
