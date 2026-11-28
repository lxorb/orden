import { account, api, ApiError, usage } from '../../accounts/src/api'
import { heldDatabase } from '../../held-database/src/api'
import { holdPicture, markPicture, picturesMoved } from '../../platform/src/api'

export interface Owed {
  hash: string
  type: string
  bytes: ArrayBuffer
  whose: string
}
const STORE = 'owed'
const database = heldDatabase('orden-pictures-owed', 1, (request) => {
  request.result.createObjectStore(STORE, { keyPath: 'hash' })
})
const WAITS = [2_000, 10_000, 30_000, 120_000, 600_000]
export const NOT_YET = 'Not uploaded yet. Orden keeps trying.'
export const FULL = 'Not uploaded, your storage is full. Orden keeps trying.'
const tries = new Map<string, number>()
const going = new Set<string>()
const waiting = new Map<string, ReturnType<typeof setTimeout>>()
let resumed: Promise<void> | null = null
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the owed pictures could not be read'))
  })
}
async function owedStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await database.transaction(STORE, mode)).objectStore(STORE)
}
const held = (one: Owed) => holdPicture(one.hash, new Blob([one.bytes], { type: one.type }))
async function everyOwed(): Promise<Owed[]> {
  try {
    return await done((await owedStore('readonly')).getAll() as IDBRequest<Owed[]>)
  } catch {
    return []
  }
}
async function write(change: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  try {
    await done(change(await owedStore('readwrite')))
  } catch {
    return
  }
}
const isFull = (error: unknown): boolean =>
  (error instanceof ApiError && error.status === 507) || (error instanceof Error && /out of space/i.test(error.message))
async function carry(one: Owed): Promise<void> {
  const token = account.accountToken
  if (going.has(one.hash) || !token || account.user?.id !== one.whose) return
  going.add(one.hash)
  clearTimeout(waiting.get(one.hash))
  try {
    await api.putBlob(token, one.hash, one.type, one.bytes)
    tries.delete(one.hash)
    markPicture(one.hash, null)
    await write((store) => store.delete(one.hash))
    void usage.refresh()
  } catch (error) {
    const tried = (tries.get(one.hash) ?? 0) + 1
    tries.set(one.hash, tried)
    const full = isFull(error)
    markPicture(one.hash, full ? FULL : NOT_YET)
    if (full) void usage.refresh()
    const wait = WAITS[Math.min(tried, WAITS.length) - 1] ?? 600_000
    const later = setTimeout(() => void carry(one), wait)
    waiting.set(one.hash, later)
  } finally {
    going.delete(one.hash)
  }
}
async function again(): Promise<void> {
  for (const one of await everyOwed()) void carry(one)
}
export function carryOwed(): Promise<void> {
  resumed ??= (async () => {
    if ('addEventListener' in globalThis) globalThis.addEventListener('online', () => void again())
    const owed = await everyOwed()
    for (const one of owed) held(one)
    if (owed.length) picturesMoved()
    for (const one of owed) void carry(one)
  })()
  return resumed
}
export async function owe(one: Owed): Promise<void> {
  held(one)
  void carryOwed()
  await write((store) => store.put(one))
  void carry(one)
}
