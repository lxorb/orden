import { invoke, isRecord, keep, log } from '../../platform/src/api'
import { type DatabaseDump, finished, shaped } from './database-dump'

export const PASS_LEFT_BEHIND = 'orden:pass-left-behind'

const PASS = 'orden-pass'

interface Carried extends DatabaseDump {
  skipped: number
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
  return out
}

export function revived(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revived)
  if (!isRecord(value)) return value
  const kind = value.$orden
  if (kind === 'bytes' && typeof value.said === 'string') return bytesOf(value.said)
  if (kind === 'undefined') return undefined
  if (kind === 'date' && typeof value.said === 'number') return new Date(value.said)
  const out: Record<string, unknown> = {}
  for (const [key, one] of Object.entries(value)) out[key] = revived(one)
  return out
}

function opened(database: DatabaseDump, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database.name, version)
    request.onupgradeneeded = () => shaped(request, database)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the database refused'))
    request.onblocked = () => reject(new Error('the database is held open'))
  })
}

async function versionOf(name: string): Promise<number | null> {
  const listing = await indexedDB.databases().catch(() => [])
  return listing.find((one) => one.name === name)?.version ?? null
}

export async function added(database: DatabaseDump): Promise<void> {
  const now = await versionOf(database.name)
  const db = await opened(database, Math.max(database.version, now ?? 1))
  try {
    const names = database.stores.map((store) => store.name).filter((name) => db.objectStoreNames.contains(name))
    if (names.length === 0) return
    const writing = db.transaction(names, 'readwrite')
    for (const shape of database.stores) {
      if (!names.includes(shape.name)) continue
      const store = writing.objectStore(shape.name)
      shape.values.forEach((value, at) => {
        const key = shape.keys[at]
        const asked =
          store.keyPath === null ? store.add(revived(value), revived(key) as IDBValidKey) : store.add(revived(value))
        asked.onerror = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
      })
    }
    await finished(writing)
  } finally {
    db.close()
  }
}

export async function carryOldDatabases(): Promise<void> {
  const said = await invoke<string | null>('old_engine_databases')
  if (!said) return
  const databases = JSON.parse(said) as Carried[]
  for (const database of databases) {
    try {
      await added(database)
      if (database.skipped > 0) {
        log('warn', `${database.skipped} records of ${database.name} could not be read from the old engine`)
      }
      if (database.name === PASS && database.skipped > 0) keep(PASS_LEFT_BEHIND, '1')
    } catch (error) {
      log('warn', `${database.name} was not carried from the old engine: ${String(error)}`)
      if (database.name === PASS) keep(PASS_LEFT_BEHIND, '1')
    }
  }
  await invoke('old_engine_databases_carried')
}
