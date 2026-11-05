/** What a browser keeps of the notes it keeps no words of (#1126): each one's scan - its
 *  links, headings, tags, front matter and task lines, what the link index and the rows
 *  of a space are made of - by the entry's id, with the `docSeq` of the words it was
 *  made from, so a scan older than the words the feed names is asked for again.
 *
 *  A database of its own per account, beside the sync store and gone with it on signing
 *  out, rather than a table of that store: the engine reads every `meta` row at start,
 *  and the scans of five thousand notes are no part of what it needs. */

import type { IndexedNote } from '@orden/scan/wire'

/** One note's scan, as kept. */
export interface IndexRow {
  id: string
  space: string
  docSeq: number
  scan: IndexedNote
}

const NOTES = 'notes'
const BY_SPACE = 'space'

const nameOf = (account: string) => `nib-index:${account}`

function database(account: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(nameOf(account), 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(NOTES, { keyPath: 'id' }).createIndex(BY_SPACE, 'space')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the index would not open'))
  })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('the index was rolled back'))
    transaction.onerror = () => reject(transaction.error ?? new Error('the index failed'))
  })
}

export interface IndexStore {
  /** Every row of a space. */
  of(space: string): Promise<IndexRow[]>
  put(rows: readonly IndexRow[]): Promise<void>
  remove(ids: readonly string[]): Promise<void>
  close(): void
}

export async function openIndex(account: string): Promise<IndexStore> {
  const db = await database(account)
  db.onversionchange = () => db.close()
  return {
    of: (space) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction(NOTES, 'readonly')
          .objectStore(NOTES)
          .index(BY_SPACE)
          .getAll(space)
        request.onsuccess = () => resolve(request.result as IndexRow[])
        request.onerror = () => reject(request.error ?? new Error('the index would not read'))
      }),
    put: (rows) => {
      const transaction = db.transaction(NOTES, 'readwrite')
      const store = transaction.objectStore(NOTES)
      for (const row of rows) store.put(row)
      return done(transaction)
    },
    remove: (ids) => {
      const transaction = db.transaction(NOTES, 'readwrite')
      const store = transaction.objectStore(NOTES)
      for (const id of ids) store.delete(id)
      return done(transaction)
    },
    close: () => db.close(),
  }
}

/** An account's index gone, on signing out: quietly, where there is none to forget. */
export function forgetIndex(account: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(nameOf(account))
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
