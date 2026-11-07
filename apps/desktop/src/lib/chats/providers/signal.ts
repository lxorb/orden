import { signalProvider, type RawStore } from '@orden/chats/signal'
import { heldDatabase, type HeldDatabase } from '../../held-database'

const STORE = 'kept'

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the device store failed'))
  })
}

function signalStore(
  db: HeldDatabase = heldDatabase('orden-signal', 1, (request) => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
  }),
): RawStore {
  const store = async (mode: IDBTransactionMode) =>
    (await db.transaction(STORE, mode)).objectStore(STORE)
  return {
    async get(key) {
      const found: unknown = await done((await store('readonly')).get(key))
      return found instanceof Uint8Array ? found : null
    },
    async put(key, value) {
      const kept = await store('readwrite')
      if (value === null) await done(kept.delete(key))
      else await done(kept.put(value, key))
    },
    async drop(prefix) {
      const kept = await store('readwrite')
      await done(kept.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)))
    },
  }
}

let shared: RawStore | null = null

export const signal = signalProvider({ store: () => (shared ??= signalStore()) })
