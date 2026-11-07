import type { PadDisk } from './sync'

const NAME = 'nib-pad'
const KEPT = 'kept'

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the scratchpad store refused'))
  })
}

function opened(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(KEPT)
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('the scratchpad store did not open'))
  })
}

export function padDisk(): PadDisk {
  let db: Promise<IDBDatabase> | null = null
  const open = () => {
    db ??= opened().catch((error: unknown) => {
      db = null
      throw error
    })
    return db
  }
  return {
    read: async (key) =>
      settled<unknown>((await open()).transaction(KEPT).objectStore(KEPT).get(key)),
    keep: async (key, value) => {
      const tx = (await open()).transaction(KEPT, 'readwrite')
      tx.objectStore(KEPT).put(value, key)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('the scratchpad store did not write'))
        tx.onabort = () => reject(tx.error ?? new Error('the scratchpad store did not write'))
      })
    },
  }
}
