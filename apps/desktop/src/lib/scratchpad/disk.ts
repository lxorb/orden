import type { PadDisk } from './sync'
import { heldDatabase } from '../held-database'

const NAME = 'orden-pad'
const KEPT = 'kept'

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the scratchpad store refused'))
  })
}

export function padDisk(): PadDisk {
  const held = heldDatabase(NAME, 1, (request) => request.result.createObjectStore(KEPT))
  return {
    read: async (key) =>
      settled<unknown>((await held.transaction(KEPT)).objectStore(KEPT).get(key)),
    keep: async (key, value) => {
      const tx = await held.transaction(KEPT, 'readwrite')
      tx.objectStore(KEPT).put(value, key)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('the scratchpad store did not write'))
        tx.onabort = () => reject(tx.error ?? new Error('the scratchpad store did not write'))
      })
    },
  }
}
