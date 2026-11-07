import { heldDatabase } from '../held-database'
import type { Row } from './ledger'
import { type Minute, minuteValue } from './minutes'

export interface TimeDisk {
  rows(): Promise<Row[]>
  put(rows: readonly Row[]): Promise<void>
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
  clear(): Promise<void>
  minutes(from: number, to: number): Promise<Minute[]>
  keepMinutes(minutes: readonly Minute[], before: number): Promise<void>
  close(): void
}

const ROWS = 'rows'
const META = 'meta'
const MINUTES = 'minutes'

const nameFor = (owner: string | null): string =>
  owner === null ? 'orden-time' : `orden-time:${owner}`

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
  const held = heldDatabase(nameFor(owner), 2, (request) => {
    const db = request.result
    if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: 'key' })
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    if (!db.objectStoreNames.contains(MINUTES)) db.createObjectStore(MINUTES, { keyPath: 'at' })
  })
  await held.transaction(META)
  return {
    rows: async () => {
      const all = await settled((await held.transaction(ROWS)).objectStore(ROWS).getAll())
      return all.map(rowOf).filter((one): one is Row => one !== null)
    },
    put: async (rows) => {
      if (!rows.length) return
      const tx = await held.transaction(ROWS, 'readwrite')
      const store = tx.objectStore(ROWS)
      for (const row of rows) store.put({ ...row, key: `${row.kind}\u0000${row.id}` })
      await finished(tx)
    },
    read: async (key) =>
      settled<unknown>((await held.transaction(META)).objectStore(META).get(key)),
    keep: async (key, value) => {
      const tx = await held.transaction(META, 'readwrite')
      tx.objectStore(META).put(value, key)
      await finished(tx)
    },
    clear: async () => {
      const tx = await held.transaction([ROWS, META], 'readwrite')
      tx.objectStore(ROWS).clear()
      tx.objectStore(META).clear()
      await finished(tx)
    },
    minutes: async (from, to) => {
      const range = IDBKeyRange.bound(from, to, false, true)
      const all = await settled(
        (await held.transaction(MINUTES)).objectStore(MINUTES).getAll(range),
      )
      return all.map(minuteValue).filter((one): one is Minute => one !== null)
    },
    keepMinutes: async (minutes, before) => {
      const tx = await held.transaction(MINUTES, 'readwrite')
      const store = tx.objectStore(MINUTES)
      for (const minute of minutes) store.put(minute)
      store.delete(IDBKeyRange.upperBound(before, true))
      await finished(tx)
    },
    close: () => held.close(),
  }
}
