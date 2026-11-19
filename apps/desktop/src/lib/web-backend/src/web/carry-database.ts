import { type DatabaseDump, dump, existing, finished, shaped } from '../../../handoff/src/api'

export const FORMER_NAME = 'nib'
const ANSWERED_WITHIN = 400
const me = crypto.randomUUID()
type Heard = 'nobody' | 'older' | 'staying'
const alive = new Map<string, Promise<Heard>>()
const staying = new Set<string>()
let answering: BroadcastChannel | null = null
function formerTabOpen(channel: string, from: string): Promise<Heard> {
  const asked = alive.get(from) ?? askedFormer(channel, from)
  alive.set(from, asked)
  return asked
}
function askedFormer(channel: string, from: string): Promise<Heard> {
  if (typeof BroadcastChannel !== 'function') return Promise.resolve('nobody')
  return new Promise((resolve) => {
    const line = new BroadcastChannel(channel)
    const done = (open: Heard) => {
      clearTimeout(timer)
      line.postMessage({ kind: 'bye', from: me })
      line.close()
      resolve(open)
    }
    const timer = setTimeout(() => done('nobody'), ANSWERED_WITHIN)
    line.onmessage = (event: MessageEvent<unknown>) => {
      const said = event.data as { kind?: unknown; from?: unknown; stays?: unknown } | null
      if (said?.kind === 'hello' || said?.kind === 'bye') return
      if (typeof said?.from !== 'string' || said.from === me) return
      if (!Array.isArray(said.stays)) done('older')
      else if (said.stays.includes(from)) done('staying')
    }
    line.postMessage({ kind: 'hello', from: me })
  })
}
export async function databaseName(from: string, to: string, former = FORMER_NAME): Promise<string> {
  if (from === to || typeof indexedDB === 'undefined') return to
  if (!(await existing(from).then(closed))) return to
  if (staying.has(from)) return from
  const channel = `${former}:windows`
  const heard = await formerTabOpen(channel, from)
  if (heard !== 'nobody') {
    if (heard === 'older' && (await existing(to).then(closed))) return to
    answerAs(channel, from)
    return from
  }
  const inUse = () => askedFormer(channel, from).then((now) => now !== 'nobody')
  const carried = await carryDatabase(from, to, inUse).catch(() => false)
  if (carried) return to
  answerAs(channel, from)
  return from
}
function answerAs(channel: string, from: string): void {
  staying.add(from)
  if (answering || typeof BroadcastChannel !== 'function') return
  const line = new BroadcastChannel(channel)
  answering = line
  line.onmessage = (event: MessageEvent<unknown>) => {
    const said = event.data as { kind?: unknown; from?: unknown } | null
    if (said?.kind === 'hello' && said.from !== me) {
      line.postMessage({ kind: 'here', from: me, stays: [...staying] })
    }
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
  const db = await existing(to)
  if (!db) return false
  try {
    for (const store of old.stores) {
      if (!store.keys.length) continue
      if (!db.objectStoreNames.contains(store.name)) return false
      const asked = db.transaction(store.name, 'readonly').objectStore(store.name).getAllKeys()
      const there = await new Promise<IDBValidKey[]>((resolve, reject) => {
        asked.onsuccess = () => resolve(asked.result)
        asked.onerror = () => reject(asked.error ?? new Error(`${to} would not list`))
      })
      const keys = new Set(there.map((key) => JSON.stringify(key)))
      if (!store.keys.every((key) => keys.has(JSON.stringify(key)))) return false
    }
    return true
  } finally {
    db.close()
  }
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
    const names = old.stores.map((store) => store.name).filter((name) => db.objectStoreNames.contains(name))
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
    const already = (asked.result as unknown[]).some((one) => sameRow(withoutKey(one, keyPath), row))
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
