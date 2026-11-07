import { breathe } from '../breathe'
import { carryDatabase } from './carry-database'
import type { PlaneMarks } from '@orden/scan/canvas'

const NAME = 'orden'
const FORMER_NAME = 'nib'
const VERSION = 2

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
  source?: string
}

interface StatRow {
  path: string
  modified: number
  created: number
  size?: number
  plane?: PlaneMarks
}

let open: Promise<IDBDatabase> | null = null
let carried: Promise<void> | null = null

function database(): Promise<IDBDatabase> {
  if (open) return open

  carried ??= carryDatabase(FORMER_NAME, NAME).catch(() => undefined)
  const opening: Promise<IDBDatabase> = carried.then(() => opened(opening))
  open = opening
  return opening
}

function opened(opening: Promise<IDBDatabase>): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
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

      if (!db.objectStoreNames.contains('stats')) {
        db.createObjectStore('stats', { keyPath: 'path' })
        fillStats(request.transaction)
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        lost(opening)
      }
      db.onclose = () => lost(opening)
      resolve(db)
    }
    request.onerror = () => {
      lost(opening)
      reject(request.error ?? new Error('could not open the database'))
    }
  })
}

function lost(was: Promise<IDBDatabase>) {
  if (open === was) open = null
}

async function begun(
  stores: string | readonly string[],
  mode: IDBTransactionMode,
): Promise<IDBTransaction> {
  const opening = database()
  const db = await opening
  try {
    return db.transaction(typeof stores === 'string' ? stores : [...stores], mode)
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error
    lost(opening)
    const again = await database()
    return again.transaction(typeof stores === 'string' ? stores : [...stores], mode)
  }
}

function fillStats(change: IDBTransaction | null) {
  if (!change) return

  const stats = change.objectStore('stats')

  for (const name of ['files', 'assets'] as const) {
    const cursor = change.objectStore(name).openCursor()
    cursor.onsuccess = () => {
      const at = cursor.result
      if (!at) return

      const row = at.value as FileRow | AssetRow
      stats.put(statOf(row))
      at.continue()
    }
  }
}

function statOf(row: FileRow | AssetRow): StatRow {
  const created = 'created' in row ? row.created : row.modified
  const size = 'content' in row ? row.content.length : row.data.length
  return { path: row.path, modified: row.modified, created, size }
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return begun(store, mode).then(
    (transaction) =>
      new Promise<T>((resolve, reject) => {
        const request = action(transaction.objectStore(store))

        if (mode === 'readonly') request.onsuccess = () => resolve(request.result as T)
        else transaction.oncomplete = () => resolve(request.result as T)
        transaction.onabort = () =>
          reject(transaction.error ?? request.error ?? new Error(`${store} was rolled back`))
        request.onerror = () => reject(request.error ?? new Error(`${store} failed`))
      }),
  )
}

function batch(
  stores: readonly string[],
  queue: (transaction: IDBTransaction) => void,
): Promise<void> {
  const named = stores.join(' and ')

  return begun(stores, 'readwrite').then(
    (transaction) =>
      new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () =>
          reject(transaction.error ?? new Error(`${named} was rolled back`))
        transaction.onerror = () => reject(transaction.error ?? new Error(`${named} failed`))

        try {
          queue(transaction)
        } catch (error) {
          transaction.abort()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }),
  )
}

function walk(store: string, visit: (row: FileRow) => void): Promise<void> {
  return begun(store, 'readonly').then(
    (transaction) =>
      new Promise<void>((resolve, reject) => {
        const request = transaction.objectStore(store).openCursor()

        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return

          visit(cursor.value as FileRow)
          cursor.continue()
        }

        transaction.oncomplete = () => resolve()
        transaction.onabort = () =>
          reject(transaction.error ?? new Error(`${store} was rolled back`))
        transaction.onerror = () => reject(transaction.error ?? new Error(`${store} failed`))
      }),
  )
}

export interface RowChange {
  written: string[]
  gone: string[]
}

const CHANNEL = 'orden:rows'

let channel: BroadcastChannel | null = null

function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  return (channel ??= new BroadcastChannel(CHANNEL))
}

function announce(written: string[], gone: string[]): void {
  bus()?.postMessage({ written, gone } satisfies RowChange)
}

function isRowChange(value: unknown): value is RowChange {
  if (typeof value !== 'object' || value === null) return false

  const shape = value as { written?: unknown; gone?: unknown }
  return (
    Array.isArray(shape.written) &&
    shape.written.every((path) => typeof path === 'string') &&
    Array.isArray(shape.gone) &&
    shape.gone.every((path) => typeof path === 'string')
  )
}

export function watchRows(heard: (change: RowChange) => void): void {
  const listening = bus()
  if (!listening) return

  listening.onmessage = (event: MessageEvent<unknown>) => {
    if (isRowChange(event.data)) heard(event.data)
  }
}

const SLICE = 500

export async function inSlices<T>(
  read: (after: string | null, most: number) => Promise<T[]>,
  keyOf: (row: T) => string,
  most: number = SLICE,
): Promise<T[]> {
  const out: T[] = []
  let after: string | null = null

  for (;;) {
    const slice = await read(after, most)
    out.push(...slice)

    const last = slice.at(-1)
    if (slice.length < most || last === undefined) return out

    after = keyOf(last)
    await breathe()
  }
}

function slice<T>(store: string, after: string | null, most: number): Promise<T[]> {
  const range = after === null ? undefined : IDBKeyRange.lowerBound(after, true)
  return run<T[]>(store, 'readonly', (one) => one.getAll(range, most))
}

const WITH_STATS = ['files', 'stats'] as const
const ASSETS_WITH_STATS = ['assets', 'stats'] as const

const ownFiles = {
  get: (path: string) => run<FileRow | undefined>('files', 'readonly', (s) => s.get(path)),
  all: () => run<FileRow[]>('files', 'readonly', (s) => s.getAll()),
  paths: () => run<string[]>('files', 'readonly', (s) => s.getAllKeys()),
  each: (visit: (row: FileRow) => void) => walk('files', visit),
  between: (from: string, to: string) =>
    run<FileRow[]>('files', 'readonly', (s) => s.getAll(IDBKeyRange.bound(from, to))),
  put: (row: FileRow) =>
    batch(WITH_STATS, (change) => {
      change.objectStore('files').put(row)
      change.objectStore('stats').put(statOf(row))
    }).then(() => announce([row.path], [])),
  write: (path: string, content: string, at: number, plane?: PlaneMarks) =>
    batch(WITH_STATS, (change) => {
      const listing = change.objectStore('stats')
      const asked = listing.get(path)
      asked.onsuccess = () => {
        const held = asked.result as StatRow | undefined
        const row = { path, content, created: held?.created ?? at, modified: at }
        change.objectStore('files').put(row)
        listing.put({ ...statOf(row), ...(plane ? { plane } : {}) })
      }
    }).then(() => announce([path], [])),
  remove: (path: string) =>
    batch(WITH_STATS, (change) => {
      change.objectStore('files').delete(path)
      change.objectStore('stats').delete(path)
    }).then(() => announce([], [path])),
  move: (rows: FileRow[], gone: string[]) => {
    const written = rows.map((row) => row.path)
    const kept = new Set(written)
    const left = gone.filter((path) => !kept.has(path))
    return batch(WITH_STATS, (change) => {
      const store = change.objectStore('files')
      const listing = change.objectStore('stats')

      for (const row of rows) {
        store.put(row)
        listing.put(statOf(row))
      }

      for (const path of left) {
        store.delete(path)
        listing.delete(path)
      }
    }).then(() => announce(written, left))
  },
}

const ownAssets = {
  get: (path: string) => run<AssetRow | undefined>('assets', 'readonly', (s) => s.get(path)),
  all: () => run<AssetRow[]>('assets', 'readonly', (s) => s.getAll()),
  paths: () => run<string[]>('assets', 'readonly', (s) => s.getAllKeys()),
  put: (row: AssetRow) =>
    batch(ASSETS_WITH_STATS, (change) => {
      change.objectStore('assets').put(row)
      change.objectStore('stats').put(statOf(row))
    }),
  remove: (path: string) =>
    batch(ASSETS_WITH_STATS, (change) => {
      change.objectStore('assets').delete(path)
      change.objectStore('stats').delete(path)
    }),
}

const ownStats = {
  holds: async (path: string) => {
    const at = await run<IDBValidKey | undefined>('stats', 'readonly', (s) => s.getKey(path))
    if (at !== undefined) return true
    const under = IDBKeyRange.bound(`${path}/`, `${path}/\uffff`)
    return (
      (await run<IDBValidKey | undefined>('stats', 'readonly', (s) => s.getKey(under))) !==
      undefined
    )
  },
  all: () =>
    inSlices<StatRow>(
      (after, most) => slice<StatRow>('stats', after, most),
      (row) => row.path,
    ),
  learn: (found: readonly { path: string; modified: number; size: number; plane?: PlaneMarks }[]) =>
    batch(['stats'], (change) => {
      const listing = change.objectStore('stats')

      for (const one of found) {
        const asked = listing.get(one.path)
        asked.onsuccess = () => {
          const row = asked.result as StatRow | undefined
          if (row?.modified !== one.modified) return
          if (row.size !== undefined && (row.plane || !one.plane)) return

          listing.put({
            ...row,
            size: row.size ?? one.size,
            ...(one.plane ? { plane: one.plane } : {}),
          })
        }
      }
    }),
}

export interface Trashed {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
  apart?: boolean
}

export interface TreeRows {
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  trash: {
    take(path: string, item: Omit<Trashed, 'from'>, beside: readonly string[]): Promise<boolean>
    words(path: string, content: string, item: Omit<Trashed, 'from'>): Promise<void>
    list(): Promise<Trashed[]>
    restore(id: string, to: string): Promise<void>
    purge(id: string): Promise<void>
  }
}

export interface Rows {
  files: typeof ownFiles
  assets: typeof ownAssets
  stats: typeof ownStats
  tree?: TreeRows
}

const OWN: Rows = { files: ownFiles, assets: ownAssets, stats: ownStats }

const OWN_HERE: Rows | null = native() ? null : OWN

function native(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const mounts = new Map<string, Rows>()

export function mountRows(root: string, rows: Rows): () => void {
  mounts.set(root, rows)
  return () => {
    if (mounts.get(root) === rows) mounts.delete(root)
  }
}

function under(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

function mountAt(path: string): { root: string; rows: Rows } | null {
  let found: { root: string; rows: Rows } | null = null
  for (const [root, rows] of mounts) {
    if ((!found || root.length > found.root.length) && under(root, path)) found = { root, rows }
  }
  return found
}

function rowsAt(path: string): Rows {
  const found = mountAt(path)?.rows ?? OWN_HERE
  if (!found) throw new Error(`${path} is in no space kept here`)
  return found
}

export function treeAt(from: string, to: string = from): TreeRows | null {
  const one = mountAt(from)
  if (!one?.rows.tree || mountAt(to)?.root !== one.root) return null
  return one.rows.tree
}

export function trees(): TreeRows[] {
  return [...mounts.values()].flatMap((rows) => (rows.tree ? [rows.tree] : []))
}

export function keepsOwnRows(): boolean {
  return OWN_HERE !== null
}

function everyRows(): Rows[] {
  return [...(OWN_HERE ? [OWN_HERE] : []), ...mounts.values()]
}

async function together<T>(
  read: (rows: Rows) => Promise<T[]>,
  keyOf: (row: T) => string,
): Promise<T[]> {
  const lists = await Promise.all(everyRows().map(read))
  if (lists.length === 1) return lists[0] ?? []
  return lists.flat().sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
}

function byRows<T>(items: readonly T[], pathOf: (item: T) => string): Map<Rows, T[]> {
  const out = new Map<Rows, T[]>()
  for (const item of items) {
    const rows = rowsAt(pathOf(item))
    out.set(rows, [...(out.get(rows) ?? []), item])
  }
  return out
}

const own = (path: string) => path

export const files: Rows['files'] = {
  get: (path) => rowsAt(path).files.get(path),
  all: () =>
    together(
      (rows) => rows.files.all(),
      (row) => row.path,
    ),
  paths: () => together((rows) => rows.files.paths(), own),
  each: async (visit) => {
    for (const rows of everyRows()) await rows.files.each(visit)
  },
  between: (from, to) =>
    together(
      (rows) => rows.files.between(from, to),
      (row) => row.path,
    ),
  put: (row) => rowsAt(row.path).files.put(row),
  write: (path, content, at, plane) => rowsAt(path).files.write(path, content, at, plane),
  remove: (path) => rowsAt(path).files.remove(path),
  move: async (rows, gone) => {
    const writes = byRows(rows, (row) => row.path)
    const drops = byRows(gone, own)
    for (const store of new Set([...writes.keys(), ...drops.keys()])) {
      await store.files.move(writes.get(store) ?? [], drops.get(store) ?? [])
    }
  },
}

export const assets: Rows['assets'] = {
  get: (path) => rowsAt(path).assets.get(path),
  all: () =>
    together(
      (rows) => rows.assets.all(),
      (row) => row.path,
    ),
  paths: () => together((rows) => rows.assets.paths(), own),
  put: (row) => rowsAt(row.path).assets.put(row),
  remove: (path) => rowsAt(path).assets.remove(path),
}

export const stats: Rows['stats'] = {
  holds: async (path) => {
    if (await rowsAt(path).stats.holds(path)) return true
    for (const [root, rows] of mounts) {
      if (root !== path && under(path, root) && (await rows.stats.holds(root))) return true
    }
    return false
  },
  all: () =>
    together(
      (rows) => rows.stats.all(),
      (row) => row.path,
    ),
  learn: async (found) => {
    for (const [rows, some] of byRows(found, (one) => one.path)) await rows.stats.learn(some)
  },
}

export const meta = {
  get: (key: string) => run<string | undefined>('meta', 'readonly', (s) => s.get(key)),
  put: (key: string, value: string) =>
    run<IDBValidKey>('meta', 'readwrite', (s) => s.put(value, key)),
  remove: (key: string) => run<undefined>('meta', 'readwrite', (s) => s.delete(key)),
  keys: () => run<IDBValidKey[]>('meta', 'readonly', (s) => s.getAllKeys()),
}

export const snapshots = {
  put: (row: SnapshotRow) => run<IDBValidKey>('snapshots', 'readwrite', (s) => s.put(row)),
  get: (id: number) => run<SnapshotRow | undefined>('snapshots', 'readonly', (s) => s.get(id)),
  newest: (notePath: string) =>
    run<IDBCursorWithValue | null>('snapshots', 'readonly', (s) =>
      s.index('notePath').openCursor(IDBKeyRange.only(notePath), 'prev'),
    ).then((cursor) => cursor?.value as SnapshotRow | undefined),
  idsOf: (notePath: string) =>
    run<number[]>('snapshots', 'readonly', (s) => s.index('notePath').getAllKeys(notePath)),
  remove: (id: number) => run<undefined>('snapshots', 'readwrite', (s) => s.delete(id)),
  forNote: (notePath: string) =>
    run<SnapshotRow[]>('snapshots', 'readonly', (s) => s.index('notePath').getAll(notePath)),
  all: () => run<SnapshotRow[]>('snapshots', 'readonly', (s) => s.getAll()),
}

export const KEEP = '.keep'
