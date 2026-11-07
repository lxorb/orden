import { type DatabaseDump, dump, existing, finished, shaped } from './database-dump'

export async function carryDatabase(from: string, to: string): Promise<void> {
  if (from === to || typeof indexedDB === 'undefined') return
  const old = await dump(from)
  if (!old) return
  if (old.stores.some((store) => store.keys.length > 0)) await merged(old, to)
  await removed(from)
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
