import {
  answerOf,
  changeOf,
  LOG_ROWS,
  patchOf,
  queryOf,
  rowOf,
  StoreError,
  TABLES,
  type Answers,
  type Change,
  type Opened,
  type Query,
  type SyncStore,
  type TableName,
} from '../sync-client/src/api'
import { databaseName } from './carry-database'
import { FORMER_NAME } from './store'
import { keptForGood } from './kept-for-good.svelte'

const SCHEMA = 1

const NAMES = Object.keys(TABLES) as TableName[]

const BY_SPACE = 'space'
const BY_AGE = 'age'

const nameOf = (account: string) => `orden-sync:${account}`
const formerNameOf = (account: string) => `nib-sync:${account}`

export async function openWeb(account: string, made?: string): Promise<SyncStore> {
  const db = await database(account)
  db.onversionchange = () => db.close()

  const opened = await started(db, made)
  return {
    opened,
    read: <const Q extends readonly Query[]>(queries: Q) => answered(db, queries),
    write: (changes) => written(db, changes),
    cleanExit: (clean) =>
      settled(db, ['meta'], (tx) => {
        tx.objectStore('meta').put({ key: 'clean_exit', value: clean ? 1 : 0 })
      }),
    close: () => {
      db.close()
      return Promise.resolve()
    },
  }
}

export async function deviceWeb(account: string): Promise<string | null> {
  return (await deviceIn(nameOf(account))) ?? deviceIn(formerNameOf(account))
}

function deviceIn(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction('meta', 'readonly')
        const asked = tx.objectStore('meta').get('device')
        asked.onsuccess = () => {
          const value = (asked.result as { value?: unknown } | undefined)?.value
          resolve(typeof value === 'string' ? value : null)
        }
        tx.oncomplete = () => db.close()
        tx.onabort = () => {
          db.close()
          resolve(null)
        }
      } catch {
        db.close()
        resolve(null)
      }
    }
  })
}

export async function forgetWeb(account: string): Promise<void> {
  await forget(formerNameOf(account))
  await forget(nameOf(account))
}

function forget(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new StoreError('the sync store stayed'))
  })
}

async function database(account: string): Promise<IDBDatabase> {
  const name = await databaseName(formerNameOf(account), nameOf(account), FORMER_NAME)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, SCHEMA)
    request.onupgradeneeded = () => made(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new StoreError('the sync store would not open'))
    request.onblocked = () => reject(new StoreError('another tab holds an older sync store open'))
  })
}

function made(db: IDBDatabase): void {
  for (const name of NAMES) {
    const spec = TABLES[name]
    const store =
      spec.key === null
        ? db.createObjectStore(name, { autoIncrement: true })
        : db.createObjectStore(name, { keyPath: spec.key })
    if (name === 'outbox') {
      store.createIndex(BY_SPACE, ['space_id', 'made_at'])
      store.createIndex(BY_AGE, 'made_at')
    } else if (spec.space !== null) {
      store.createIndex(BY_SPACE, spec.space)
    }
  }
}

function started(db: IDBDatabase, made?: string): Promise<Opened> {
  const found: { device?: unknown; clean?: unknown } = {}
  let device = ''

  return settled(db, ['meta'], (tx) => {
    const meta = tx.objectStore('meta')
    const asked = meta.get('device')
    asked.onsuccess = () => {
      found.device = (asked.result as { value?: unknown } | undefined)?.value
      device = typeof found.device === 'string' ? found.device : (made ?? crypto.randomUUID())
      if (device !== found.device) meta.put({ key: 'device', value: device })
    }
    const clean = meta.get('clean_exit')
    clean.onsuccess = () => {
      found.clean = (clean.result as { value?: unknown } | undefined)?.value
      meta.put({ key: 'clean_exit', value: 0 })
    }
    meta.put({ key: 'schema', value: SCHEMA })
  }).then(() => ({
    device,
    wasClean: found.clean !== 0,
    schema: SCHEMA,
    recovered: false,
  }))
}

async function answered<const Q extends readonly Query[]>(
  db: IDBDatabase,
  queries: Q,
): Promise<Answers<Q>> {
  for (const query of queries) queryOf(query)
  if (queries.length === 0) return [] as Answers<Q>

  const raw: unknown[] = []
  const tables = [...new Set(queries.map((query) => query.table))]
  await settled(
    db,
    tables,
    (tx) => {
      queries.forEach((query, at) => {
        const store = tx.objectStore(query.table)
        const request =
          query.t === 'get'
            ? store.get(query.key)
            : query.space !== undefined
              ? spaceIndexRead(store, query.table, query.space)
              : query.table === 'outbox'
                ? store.index(BY_AGE).getAll()
                : store.getAll()
        request.onsuccess = () => {
          raw[at] = request.result
        }
      })
    },
    'readonly',
  )

  return queries.map((query, at) => answerOf(query, raw[at] ?? null)) as Answers<Q>
}

function spaceIndexRead(store: IDBObjectStore, table: TableName, space: string): IDBRequest {
  const index = store.index(BY_SPACE)
  if (table !== 'outbox') return index.getAll(space)
  return index.getAll(IDBKeyRange.bound([space, -Infinity], [space, Infinity]))
}

async function written(db: IDBDatabase, changes: readonly Change[]): Promise<number[]> {
  const checked = changes.map((change) => changeOf(change))
  if (checked.length === 0) return []

  const counts = checked.map(() => 0)
  const tables = [...new Set(checked.map((change) => change.table))]
  let logged = false

  await settled(db, tables, (tx) => {
    checked.forEach((change, at) => {
      const store = tx.objectStore(change.table)
      switch (change.t) {
        case 'put': {
          store.put(rowOf(change.table, change.row))
          counts[at] = 1
          logged ||= change.table === 'log'
          return
        }
        case 'patch': {
          const set = patchOf(change.table, change.set)
          const found = store.get(change.key)
          found.onsuccess = () => {
            const row: unknown = found.result
            if (typeof row !== 'object' || row === null) return
            store.put({ ...row, ...set })
            counts[at] = 1
          }
          return
        }
        case 'delete': {
          const there = store.count(change.key)
          there.onsuccess = () => {
            counts[at] = there.result
          }
          store.delete(change.key)
          return
        }
        case 'clear': {
          const keys = spaceKeys(store, change.table, change.space)
          keys.onsuccess = () => {
            counts[at] = keys.result.length
            for (const key of keys.result) store.delete(key)
          }
          return
        }
      }
    })
    if (logged) trim(tx.objectStore('log'))
  })

  if (checked.some(unsent)) void keptForGood.ask()
  return counts
}

function unsent(change: Change): boolean {
  if (change.table === 'outbox') return change.t === 'put'
  if (change.table !== 'docs') return false
  if (change.t === 'put') return change.row.pending != null
  return change.t === 'patch' && change.set.pending != null
}

function spaceKeys(
  store: IDBObjectStore,
  table: TableName,
  space: string,
): IDBRequest<IDBValidKey[]> {
  const index = store.index(BY_SPACE)
  if (table !== 'outbox') return index.getAllKeys(space)
  return index.getAllKeys(IDBKeyRange.bound([space, -Infinity], [space, Infinity]))
}

function trim(log: IDBObjectStore): void {
  const counted = log.count()
  counted.onsuccess = () => {
    let over = counted.result - LOG_ROWS
    if (over <= 0) return
    const walking = log.openCursor()
    walking.onsuccess = () => {
      const cursor = walking.result
      if (!cursor || over <= 0) return
      cursor.delete()
      over -= 1
      cursor.continue()
    }
  }
}

function settled(
  db: IDBDatabase,
  tables: readonly string[],
  queue: (tx: IDBTransaction) => void,
  mode: IDBTransactionMode = 'readwrite',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...tables], mode)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new StoreError('the sync store rolled a batch back'))
    tx.onerror = () => reject(tx.error ?? new StoreError('the sync store failed'))
    try {
      queue(tx)
    } catch (error) {
      tx.abort()
      reject(error instanceof Error ? error : new StoreError(String(error)))
    }
  })
}
