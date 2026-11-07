import { heldDatabase } from '../held-database'
import { type InboxDisk, type Kept, keptOver } from './store'

const ITEMS = 'items'
const META = 'meta'
const CURSOR = 'cursor'

const nameFor = (owner: string | null): string =>
  owner === null ? 'orden-inbox' : `orden-inbox:${owner}`

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the inbox store refused'))
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('the inbox store did not write'))
    tx.onabort = () => reject(tx.error ?? new Error('the inbox store did not write'))
  })
}

const keptOf = (value: unknown): Kept | null => {
  if (typeof value !== 'object' || value === null) return null
  const { id, fields, stamps, dirty } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof fields !== 'object' || fields === null) return null
  if (typeof stamps !== 'object' || stamps === null) return null
  return {
    id,
    fields: fields as Kept['fields'],
    stamps: stamps as Kept['stamps'],
    dirty: Array.isArray(dirty)
      ? dirty.filter((one): one is string => typeof one === 'string')
      : [],
  }
}

export interface ClosingDisk extends InboxDisk {
  close(): void
  clear(): Promise<void>
}

export async function openInboxDisk(owner: string | null): Promise<ClosingDisk> {
  const held = heldDatabase(nameFor(owner), 1, (request) => {
    const db = request.result
    if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'id' })
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
  })
  await held.transaction(META)
  return {
    items: async () => {
      const all = await settled((await held.transaction(ITEMS)).objectStore(ITEMS).getAll())
      return all.map(keptOf).filter((one): one is Kept => one !== null)
    },
    put: async (items) => {
      if (!items.length) return []
      const tx = await held.transaction(ITEMS, 'readwrite')
      const store = tx.objectStore(ITEMS)
      const out: Kept[] = []
      for (const item of items) {
        const read = store.get(item.id)
        read.onsuccess = () => {
          const kept = keptOver(keptOf(read.result) ?? undefined, item)
          store.put(kept)
          out.push(kept)
        }
      }
      await finished(tx)
      return out
    },
    cursor: async () => {
      const read = await settled<unknown>(
        (await held.transaction(META)).objectStore(META).get(CURSOR),
      )
      return typeof read === 'number' ? read : 0
    },
    keepCursor: async (cursor) => {
      const tx = await held.transaction(META, 'readwrite')
      tx.objectStore(META).put(cursor, CURSOR)
      await finished(tx)
    },
    clear: async () => {
      const tx = await held.transaction([ITEMS, META], 'readwrite')
      tx.objectStore(ITEMS).clear()
      tx.objectStore(META).clear()
      await finished(tx)
    },
    close: () => held.close(),
  }
}
