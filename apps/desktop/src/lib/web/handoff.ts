import { carryKeys } from '../former-keys'
import { keep, storedText } from '../platform/src/api'
import { type DatabaseDump, dump, finished, shaped } from './database-dump'

export const WEB: string = import.meta.env.VITE_ORDEN_WEB ?? 'https://orden.so'
export const LEGACY_WEB: string = import.meta.env.VITE_ORDEN_LEGACY_WEB ?? 'https://nibeditor.com'

export const HANDOFF_PATH = '/handoff'

const KIND = 'orden-handoff'
const FORMER_KIND = 'nib-handoff'

const NOTES = ['orden', 'nib']

export interface Handoff {
  kind: typeof KIND | typeof FORMER_KIND
  databases: DatabaseDump[]
  local: [string, string][]
}

export function isHandoff(value: unknown): value is Handoff {
  if (typeof value !== 'object' || value === null) return false
  const said = value as Partial<Handoff>
  return (
    (said.kind === KIND || said.kind === FORMER_KIND) &&
    Array.isArray(said.databases) &&
    Array.isArray(said.local)
  )
}

export function isEmpty(handoff: Handoff): boolean {
  return (
    handoff.local.length === 0 &&
    handoff.databases.every((database) => database.stores.every((store) => store.keys.length === 0))
  )
}

async function listed(): Promise<{ name: string; version: number }[]> {
  if (!('databases' in indexedDB)) return []
  const listing = await indexedDB.databases().catch(() => null)
  if (!listing) return []
  return listing.flatMap((one) =>
    typeof one.name === 'string' && typeof one.version === 'number'
      ? [{ name: one.name, version: one.version }]
      : [],
  )
}

export async function pack(): Promise<Handoff> {
  const names = (await listed()).map((one) => one.name)
  const databases: DatabaseDump[] = []
  for (const name of names.length > 0 ? names : NOTES) {
    const one = await dump(name)
    if (one) databases.push(one)
  }

  const local: [string, string][] = []
  for (let at = 0; at < localStorage.length; at++) {
    const key = localStorage.key(at)
    const value = key === null ? null : storedText(key)
    if (key !== null && value !== null) local.push([key, value])
  }

  return { kind: KIND, databases, local }
}

const LISTING = 'stats'
interface Listed {
  path: string
  modified: number
  created?: number
  content?: string
  data?: string
}
function listingOf(row: Listed) {
  const size = (row.content ?? row.data ?? '').length
  return { path: row.path, modified: row.modified, created: row.created ?? row.modified, size }
}

function restore(database: DatabaseDump, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database.name, version)

    request.onupgradeneeded = () => shaped(request, database)

    request.onblocked = () => reject(new Error('another tab holds the notes open'))
    request.onerror = () => reject(request.error ?? new Error('the database refused'))

    request.onsuccess = () => {
      const db = request.result
      const names = database.stores
        .map((store) => store.name)
        .filter((name) => db.objectStoreNames.contains(name))
      if (names.length === 0) {
        db.close()
        resolve()
        return
      }

      const listing =
        NOTES.includes(database.name) &&
        db.objectStoreNames.contains(LISTING) &&
        !names.includes(LISTING)
          ? LISTING
          : null
      const writing = db.transaction(listing ? [...names, listing] : names, 'readwrite')
      for (const shape of database.stores) {
        if (!names.includes(shape.name)) continue
        const store = writing.objectStore(shape.name)
        store.clear()
        shape.values.forEach((value, at) => {
          if (shape.keyPath === null) store.put(value, shape.keys[at])
          else store.put(value)
        })
      }
      if (listing) {
        const stats = writing.objectStore(listing)
        stats.clear()
        for (const shape of database.stores) {
          if (shape.name !== 'files' && shape.name !== 'assets') continue
          for (const value of shape.values) stats.put(listingOf(value as Listed))
        }
      }
      finished(writing)
        .then(resolve, reject)
        .finally(() => db.close())
    }
  })
}

export async function unpack(handoff: Handoff): Promise<void> {
  const versions = new Map((await listed()).map((one) => [one.name, one.version]))
  for (const database of handoff.databases) {
    await restore(database, Math.max(database.version, versions.get(database.name) ?? 1))
  }
  for (const [key, value] of handoff.local) {
    if (!keep(key, value)) throw new Error('this browser keeps no more site data')
  }
  carryKeys(localStorage)
}
