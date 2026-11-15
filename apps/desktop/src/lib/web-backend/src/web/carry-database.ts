import { type DatabaseDump, dump, existing, finished, shaped } from '../../../handoff/src/api'

export const FORMER_NAME = 'nib'

const ANSWERED_WITHIN = 400

const me = crypto.randomUUID()

let alive: Promise<boolean> | null = null
let answering: BroadcastChannel | null = null

function formerTabOpen(channel: string): Promise<boolean> {
  return (alive ??= askedFormer(channel))
}

function askedFormer(channel: string): Promise<boolean> {
  if (typeof BroadcastChannel !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    const line = new BroadcastChannel(channel)
    const done = (open: boolean) => {
      clearTimeout(timer)
      line.postMessage({ kind: 'bye', from: me })
      line.close()
      resolve(open)
    }
    const timer = setTimeout(() => done(false), ANSWERED_WITHIN)
    line.onmessage = (event: MessageEvent<unknown>) => {
      const said = event.data as { kind?: unknown; from?: unknown } | null
      if (said?.kind === 'hello' || said?.kind === 'bye') return
      if (typeof said?.from === 'string' && said.from !== me) done(true)
    }
    line.postMessage({ kind: 'hello', from: me })
  })
}

export async function databaseName(
  from: string,
  to: string,
  former = FORMER_NAME,
): Promise<string> {
  if (from === to || typeof indexedDB === 'undefined') return to
  if (!(await existing(from).then(closed))) return to
  const channel = `${former}:windows`
  if (await formerTabOpen(channel)) {
    if (await existing(to).then(closed)) return to
    answerAs(channel)
    return from
  }
  const carried = await carryDatabase(from, to, () => askedFormer(channel)).catch(() => false)
  return carried ? to : from
}

function answerAs(channel: string): void {
  if (answering || typeof BroadcastChannel !== 'function') return
  const line = new BroadcastChannel(channel)
  answering = line
  line.onmessage = (event: MessageEvent<unknown>) => {
    const said = event.data as { kind?: unknown; from?: unknown } | null
    if (said?.kind === 'hello' && said.from !== me) line.postMessage({ kind: 'here', from: me })
  }
}

function closed(db: IDBDatabase | null): boolean {
  db?.close()
  return db !== null
}

export async function carryDatabase(
  from: string,
  to: string,
  inUse: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<boolean> {
  if (from === to || typeof indexedDB === 'undefined') return true
  const old = await dump(from)
  if (!old) return true
  if (old.stores.some((store) => store.keys.length > 0)) {
    await merged(old, to)
    if (!(await holdsAll(old, to))) return false
  }
  if (await inUse()) return true
  await removed(from)
  return true
}

async function holdsAll(old: DatabaseDump, to: string): Promise<boolean> {
  const now = await dump(to)
  if (!now) return false
  return old.stores.every((store) => {
    if (!store.keys.length) return true
    const there = now.stores.find((one) => one.name === store.name)
    if (!there) return false
    const keys = new Set(there.keys.map((key) => JSON.stringify(key)))
    return store.keys.every((key) => keys.has(JSON.stringify(key)))
  })
}

async function merged(old: DatabaseDump, to: string): Promise<void> {
  const there = await existing(to)
  const version = Math.max(old.version, there?.version ?? 1)
  there?.close()

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(to, version)
    request.onupgradeneeded = () => shaped(request, old)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`${to} would not open`))
    request.onblocked = () => reject(new Error(`another tab holds ${to} open`))
  })

  try {
    const names = old.stores
      .map((store) => store.name)
      .filter((name) => db.objectStoreNames.contains(name))
    if (names.length === 0) return
    const writing = db.transaction(names, 'readwrite')
    for (const shape of old.stores) {
      if (!names.includes(shape.name)) continue
      const store = writing.objectStore(shape.name)
      shape.keys.forEach((key, at) => {
        const value = shape.values[at]
        const held = store.get(key)
        held.onsuccess = () => {
          const there: unknown = held.result
          if (there === undefined) {
            if (shape.keyPath === null) store.put(value, key)
            else store.put(value)
          } else if (shape.autoIncrement && !sameRow(there, value)) {
            keptBeside(store, shape.indexes, withoutKey(value, shape.keyPath), shape.keyPath)
          } else if (shape.keyPath !== null && changedLater(value, there)) {
            store.put(value)
          }
        }
      })
    }
    await finished(writing)
  } finally {
    db.close()
  }
}

function keptBeside(
  store: IDBObjectStore,
  indexes: readonly { name: string; keyPath: string | string[] }[],
  row: unknown,
  keyPath: string | string[] | null,
): void {
  const by = indexes.find((one) => typeof one.keyPath === 'string')
  const near = by ? valueAt(row, by.keyPath as string) : undefined
  if (!by || near === undefined) {
    store.put(row)
    return
  }

  const asked = store.index(by.name).getAll(near as IDBValidKey)
  asked.onsuccess = () => {
    const already = (asked.result as unknown[]).some((one) =>
      sameRow(withoutKey(one, keyPath), row),
    )
    if (!already) store.put(row)
  }
}

function valueAt(row: unknown, key: string): unknown {
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[key] : undefined
}

function changedLater(value: unknown, than: unknown): boolean {
  const at = modifiedOf(value)
  const other = modifiedOf(than)
  return at !== null && other !== null && at > other
}

function modifiedOf(row: unknown): number | null {
  if (typeof row !== 'object' || row === null) return null
  const modified = (row as { modified?: unknown }).modified
  return typeof modified === 'number' ? modified : null
}

function sameRow(one: unknown, other: unknown): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}

function withoutKey(value: unknown, keyPath: string | string[] | null): unknown {
  if (typeof keyPath !== 'string' || typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== keyPath))
}

function removed(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
