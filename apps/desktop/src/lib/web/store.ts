/** The browser's stand-in for a disk. Notes are rows keyed by path, so the same
 *  path-shaped commands the desktop app sends work unchanged. IndexedDB rather
 *  than localStorage: it holds megabytes, and it can hold images. */

const NAME = 'nib'
const VERSION = 1

export interface FileRow {
  path: string
  content: string
  modified: number
  created: number
}

export interface AssetRow {
  path: string
  type: string
  data: string
  modified: number
}

export interface SnapshotRow {
  id?: number
  notePath: string
  content: string
  taken_at: number
  size: number
}

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  if (open) return open

  open = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' })
      if (!db.objectStoreNames.contains('assets'))
        db.createObjectStore('assets', { keyPath: 'path' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')

      if (!db.objectStoreNames.contains('snapshots')) {
        const store = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        store.createIndex('notePath', 'notePath')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not open the database'))
  })

  return open
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = action(transaction.objectStore(store))

        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error ?? new Error(`${store} failed`))
      }),
  )
}

/** Several writes as one. IndexedDB commits a transaction when the last
 *  request in it settles, so the whole batch has to be queued together: this
 *  resolves on the transaction rather than on any one request, which is what
 *  makes "all of it, or none of it" true. */
function batch(store: string, queue: (store: IDBObjectStore) => void): Promise<void> {
  return database().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite')

        transaction.oncomplete = () => resolve()
        transaction.onabort = () =>
          reject(transaction.error ?? new Error(`${store} was rolled back`))
        transaction.onerror = () => reject(transaction.error ?? new Error(`${store} failed`))

        queue(transaction.objectStore(store))
      }),
  )
}

export const files = {
  get: (path: string) => run<FileRow | undefined>('files', 'readonly', (s) => s.get(path)),
  all: () => run<FileRow[]>('files', 'readonly', (s) => s.getAll()),
  put: (row: FileRow) => run<IDBValidKey>('files', 'readwrite', (s) => s.put(row)),
  remove: (path: string) => run<undefined>('files', 'readwrite', (s) => s.delete(path)),
  /** Writes `rows` and drops `gone`, all or nothing. What a rename is: every
   *  note under the folder lands under its new name at the same moment. */
  move: (rows: FileRow[], gone: string[]) =>
    batch('files', (store) => {
      for (const row of rows) store.put(row)
      // After the writes, so a path that is both written and dropped - a
      // rename that only changes a folder above it - keeps the new row.
      for (const path of gone) {
        if (!rows.some((row) => row.path === path)) store.delete(path)
      }
    }),
}

export const assets = {
  get: (path: string) => run<AssetRow | undefined>('assets', 'readonly', (s) => s.get(path)),
  all: () => run<AssetRow[]>('assets', 'readonly', (s) => s.getAll()),
  put: (row: AssetRow) => run<IDBValidKey>('assets', 'readwrite', (s) => s.put(row)),
  remove: (path: string) => run<undefined>('assets', 'readwrite', (s) => s.delete(path)),
}

export const meta = {
  get: (key: string) => run<string | undefined>('meta', 'readonly', (s) => s.get(key)),
  put: (key: string, value: string) =>
    run<IDBValidKey>('meta', 'readwrite', (s) => s.put(value, key)),
}

export const snapshots = {
  put: (row: SnapshotRow) => run<IDBValidKey>('snapshots', 'readwrite', (s) => s.put(row)),
  remove: (id: number) => run<undefined>('snapshots', 'readwrite', (s) => s.delete(id)),
  forNote: (notePath: string) =>
    run<SnapshotRow[]>('snapshots', 'readonly', (s) => s.index('notePath').getAll(notePath)),
}

/** Folders have no rows of their own - a folder exists because something is in
 *  it. This is the marker that keeps an empty one alive. */
export const KEEP = '.keep'
