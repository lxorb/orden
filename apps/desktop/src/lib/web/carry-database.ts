import { type DatabaseDump, dump, existing, finished, shaped } from './database-dump'

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

export async function databaseName(from: string, to: string, former: string): Promise<string> {
  if (from === to || typeof indexedDB === 'undefined') return to
  const channel = `${former}:windows`
  if (await formerTabOpen(channel)) {
    if (await existing(to).then(closed)) return to
    answerAs(channel)
    return from
  }
  await carryDatabase(from, to, () => askedFormer(channel)).catch(() => undefined)
  return to
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
): Promise<void> {
  if (from === to || typeof indexedDB === 'undefined') return
  const old = await dump(from)
  if (!old) return
  if (old.stores.some((store) => store.keys.length > 0)) {
    await merged(old, to)
    if (!(await holdsAll(old, to))) return
  }
  if (await inUse()) return
  await removed(from)
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
        const held = store.count(key)
        held.onsuccess = () => {
          if (held.result > 0) return
          if (shape.keyPath === null) store.put(shape.values[at], key)
          else store.put(shape.values[at])
        }
      })
    }
    await finished(writing)
  } finally {
    db.close()
  }
}

function removed(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
