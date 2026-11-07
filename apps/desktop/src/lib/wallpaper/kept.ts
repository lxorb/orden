import { heldDatabase } from '../held-database'

const NAME = 'orden-wallpaper'
const STORE = 'picture'

export type Copy = 'source' | 'source-dark'

const held = heldDatabase(NAME, 1, (request) => request.result.createObjectStore(STORE))

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the wallpaper store refused'))
  })
}

async function asked<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>) {
  return settled(ask((await held.transaction(STORE, mode)).objectStore(STORE)))
}

export async function keepSource(picture: Blob, key: Copy = 'source'): Promise<boolean> {
  try {
    await asked('readwrite', (store) => store.put(picture, key))
    return true
  } catch {
    return false
  }
}

export async function keptSource(key: Copy = 'source'): Promise<Blob | null> {
  try {
    const found: unknown = await asked('readonly', (store) => store.get(key))
    return found instanceof Blob ? found : null
  } catch {
    return null
  }
}

export async function forgetSource(key: Copy = 'source'): Promise<void> {
  try {
    await asked('readwrite', (store) => store.delete(key))
  } catch {
    // Nothing kept is what was asked for.
  }
}
