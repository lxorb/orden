import type { KdfParams } from '@orden/pass/crypto'
import { kdfParamsIn } from '@orden/pass/crypto'
import type { DeviceSeal } from '@orden/pass/device'
import type { Keyring } from '@orden/pass/keys'
import { keyringIn } from '@orden/pass/keys'
import type { Role } from '@orden/pass/types'
import type { Accepted, Handover, KeyProof } from '@orden/pass/wire'

const NAME = 'orden-pass'
const VERSION = 2
const THIS = 'this'

const KEPT_VERSIONS = 30
export const KEPT_AFTER_DELETE = 30 * 24 * 60 * 60 * 1000

export interface KeyringRow {
  keyring: Keyring
  rev: number
  pending: boolean
}

export interface DeviceRow {
  seal: DeviceSeal
  kdf: KdfParams
}

export interface VaultRow {
  id: string
  rev: number
  meta: string
  key: string
  keyVersion: number
  role: Role
  owner: string
  members: number
  pending: boolean
  deleted: boolean
  proof?: KeyProof | null
  accepted?: Accepted | null
  handovers?: Handover[]
}

export interface ItemRow {
  vault: string
  id: string
  rev: number
  key: string
  body: string
  keyVersion: number
  at: number
  pending: boolean
  deleted: boolean
}

export interface VersionRow {
  vault: string
  id: string
  rev: number
  key: string
  body: string
  at: number
}

export interface ItemRef {
  vault: string
  id: string
}

export interface FilePartRow {
  item: string
  file: string
  part: number
  parts: number
  bytes: Uint8Array<ArrayBuffer>
}

export interface Change {
  vaults?: VaultRow[]
  items?: ItemRow[]
  versions?: VersionRow[]
  dropVersions?: ItemRef[]
}

type StoreName = 'keyring' | 'device' | 'vaults' | 'items' | 'versions' | 'meta' | 'files'

let opening: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const has = (name: StoreName) => db.objectStoreNames.contains(name)
      if (!has('keyring')) db.createObjectStore('keyring')
      if (!has('device')) db.createObjectStore('device')
      if (!has('vaults')) db.createObjectStore('vaults', { keyPath: 'id' })
      if (!has('items')) db.createObjectStore('items', { keyPath: ['vault', 'id'] })
      if (!has('versions')) db.createObjectStore('versions', { keyPath: ['vault', 'id', 'rev'] })
      if (!has('meta')) db.createObjectStore('meta')
      if (!has('files')) db.createObjectStore('files', { keyPath: ['item', 'file', 'part'] })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error('pass: the device store could not be opened'))
    }
  })
  return opening
}

function answer<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('pass: the device store failed'))
  })
}

function finished(change: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error ?? new Error('pass: the device store failed'))
    change.onabort = () => reject(change.error ?? new Error('pass: a write was abandoned'))
  })
}

async function read<T>(name: StoreName, ask: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return await answer(ask(db.transaction(name, 'readonly').objectStore(name)))
}

async function put(name: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await database()
  const change = db.transaction(name, 'readwrite')
  const done = finished(change)
  const store = change.objectStore(name)
  if (value === null && key !== undefined) store.delete(key)
  else store.put(value, key)
  await done
}

function versionsOf(vault: string, id: string): IDBKeyRange {
  return IDBKeyRange.bound([vault, id, -Infinity], [vault, id, Infinity])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deviceSealIn(value: unknown): DeviceSeal | null {
  if (!isRecord(value)) return null
  const { way, salt, sealed, tries } = value
  if (way !== 'device' && way !== 'pin') return null
  if (!(salt === null || typeof salt === 'string') || typeof sealed !== 'string') return null
  if (typeof tries !== 'number' || !Number.isInteger(tries) || tries < 0) return null
  return { way, salt, sealed, tries }
}

export async function readKeyring(): Promise<KeyringRow | null> {
  const row: unknown = await read('keyring', (store) => store.get(THIS))
  if (!isRecord(row)) return null
  const keyring = keyringIn(row.keyring)
  if (keyring === null || typeof row.rev !== 'number') return null
  return { keyring, rev: row.rev, pending: row.pending === true }
}

export async function writeKeyring(row: KeyringRow): Promise<void> {
  await put('keyring', row, THIS)
}

export async function readDevice(): Promise<DeviceRow | null> {
  return deviceRowIn(await read('device', (store) => store.get(THIS)))
}

export async function writeDevice(row: DeviceRow | null): Promise<void> {
  await put('device', row, THIS)
}

function deviceRowIn(row: unknown): DeviceRow | null {
  if (!isRecord(row)) return null
  const seal = deviceSealIn(row.seal)
  const kdf = kdfParamsIn(row.kdf)
  return seal === null || kdf === null ? null : { seal, kdf }
}

export async function spendPinTry(): Promise<DeviceRow | null> {
  const db = await database()
  const writing = db.transaction('device', 'readwrite')
  const done = finished(writing)
  const store = writing.objectStore('device')
  let row: DeviceRow | null = null
  const reading = store.get(THIS)
  reading.onsuccess = () => {
    row = deviceRowIn(reading.result)
    if (row?.seal.way !== 'pin') return
    row = { ...row, seal: { ...row.seal, tries: row.seal.tries + 1 } }
    store.put(row, THIS)
  }
  await done
  return row
}

export async function clearPinTries(sealed: string): Promise<DeviceRow | null> {
  const db = await database()
  const writing = db.transaction('device', 'readwrite')
  const done = finished(writing)
  const store = writing.objectStore('device')
  let row: DeviceRow | null = null
  const reading = store.get(THIS)
  reading.onsuccess = () => {
    row = deviceRowIn(reading.result)
    if (row?.seal.way !== 'pin' || row.seal.sealed !== sealed) return
    row = { ...row, seal: { ...row.seal, tries: 0 } }
    store.put(row, THIS)
  }
  await done
  return row
}

export async function readVaults(): Promise<VaultRow[]> {
  return (await read('vaults', (store) => store.getAll())) as VaultRow[]
}

export async function readItems(): Promise<ItemRow[]> {
  return (await read('items', (store) => store.getAll())) as ItemRow[]
}

export async function readItem(vault: string, id: string): Promise<ItemRow | null> {
  const row = (await read('items', (store) => store.get([vault, id]))) as ItemRow | undefined
  return row ?? null
}

export async function readVersions(vault: string, id: string): Promise<VersionRow[]> {
  const rows = (await read('versions', (store) =>
    store.getAll(versionsOf(vault, id)),
  )) as VersionRow[]
  return rows.reverse()
}

export async function readMeta(key: string): Promise<unknown> {
  return await read('meta', (store) => store.get(key))
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await put('meta', value, key)
}

function partsOf(item: string, file?: string): IDBKeyRange {
  return file === undefined
    ? IDBKeyRange.bound([item], [item, []])
    : IDBKeyRange.bound([item, file, -Infinity], [item, file, Infinity])
}

export async function readFileParts(item: string, file: string): Promise<FilePartRow[]> {
  return (await read('files', (store) => store.getAll(partsOf(item, file)))) as FilePartRow[]
}

export async function writeFileParts(rows: readonly FilePartRow[]): Promise<void> {
  const db = await database()
  const writing = db.transaction('files', 'readwrite')
  const done = finished(writing)
  const store = writing.objectStore('files')
  for (const row of rows) store.put(row)
  await done
}

export async function dropFileParts(item: string, file?: string): Promise<void> {
  const db = await database()
  const writing = db.transaction('files', 'readwrite')
  const done = finished(writing)
  writing.objectStore('files').delete(partsOf(item, file))
  await done
}

function prune(store: IDBObjectStore, ref: ItemRef): void {
  const keys = store.getAllKeys(versionsOf(ref.vault, ref.id))
  keys.onsuccess = () => {
    const extra = keys.result.length - KEPT_VERSIONS
    for (const key of keys.result.slice(0, Math.max(0, extra))) store.delete(key)
  }
}

export async function write(change: Change): Promise<void> {
  const db = await database()
  const writing = db.transaction(['vaults', 'items', 'versions'], 'readwrite')
  const done = finished(writing)
  const vaults = writing.objectStore('vaults')
  const items = writing.objectStore('items')
  const versions = writing.objectStore('versions')
  for (const row of change.vaults ?? []) vaults.put(row)
  for (const row of change.items ?? []) items.put(row)
  for (const ref of change.dropVersions ?? []) versions.delete(versionsOf(ref.vault, ref.id))
  for (const row of change.versions ?? []) versions.put(row)
  const touched = new Map((change.versions ?? []).map((row) => [`${row.vault}\n${row.id}`, row]))
  for (const ref of touched.values()) prune(versions, ref)
  await done
}

async function closeLocal(): Promise<void> {
  const was = opening
  opening = null
  if (was) (await was.catch(() => null))?.close()
}

export async function forgetLocal(): Promise<void> {
  await closeLocal()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('pass: the device store stayed'))
  })
}
