// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'

/** The engine kept signed out and the account's, one after the other (#1068, step 4b):
 *  the crate keeps one sync store open at a time and closes whichever that is, so the
 *  account's engine opens its store only once the one kept signed out has closed its
 *  own, and signing in lets the store kept signed out go. */

const said = vi.hoisted(() => [] as string[])
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
      const store = new MemoryStore(id).open()
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
      return Promise.resolve()
    },
  }
})

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

    expect(said.slice(0, 3)).toEqual(['open local', 'close local', 'open u1'])
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
})
