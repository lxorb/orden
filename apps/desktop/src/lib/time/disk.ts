import type { Row } from './ledger'

export interface TimeDisk {
  rows(): Promise<Row[]>
  put(rows: readonly Row[]): Promise<void>
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
  clear(): Promise<void>
  close(): void
}

const ROWS = 'rows'
const META = 'meta'

const nameFor = (owner: string | null): string =>
  owner === null ? 'nib-time' : `nib-time:${owner}`

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the time store refused'))
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('the time store did not write'))
    tx.onabort = () => reject(tx.error ?? new Error('the time store did not write'))
  })
}

function opened(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ROWS, { keyPath: 'key' })
      request.result.createObjectStore(META)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the time store did not open'))
  })
}

const rowOf = (value: unknown): Row | null => {
  if (typeof value !== 'object' || value === null) return null
  const { kind, id, value: held, dirty, at } = value as Record<string, unknown>
  if (typeof kind !== 'string' || typeof id !== 'string') return null
  return {
    kind,
    id,
    value: typeof held === 'object' && held !== null ? (held as Record<string, unknown>) : null,
    dirty: typeof dirty === 'number' ? dirty : 0,
    at: typeof at === 'number' ? at : 0,
  }
}

export async function openTimeDisk(owner: string | null): Promise<TimeDisk> {
  const db = await opened(nameFor(owner))
  db.onversionchange = () => db.close()
  return {
    rows: async () => {
      const all = await settled(db.transaction(ROWS).objectStore(ROWS).getAll())
      return all.map(rowOf).filter((one): one is Row => one !== null)
    },
    put: async (rows) => {
      if (!rows.length) return
      const tx = db.transaction(ROWS, 'readwrite')
      const store = tx.objectStore(ROWS)
      for (const row of rows) store.put({ ...row, key: `${row.kind}\u0000${row.id}` })
      await finished(tx)
    },
    read: (key) => settled(db.transaction(META).objectStore(META).get(key)),
    keep: async (key, value) => {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(value, key)
      await finished(tx)
    },
    clear: async () => {
      const tx = db.transaction([ROWS, META], 'readwrite')
      tx.objectStore(ROWS).clear()
      tx.objectStore(META).clear()
      await finished(tx)
    },
    close: () => db.close(),
  }
}
