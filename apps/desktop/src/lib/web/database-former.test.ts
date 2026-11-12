import '../sync-ports'
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { get, put } from '../sync-client/src/store'
import { leadSync } from '../sync-client/src/lead'
import { carryDatabase } from './carry-database'
import { files } from './store'
import { deviceWeb, forgetWeb, openWeb } from './sync-store'

function opened(name: string, version: number, made: (db: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => made(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('not opened'))
  })
}

function written(db: IDBDatabase, store: string, rows: unknown[]) {
  return new Promise<void>((resolve, reject) => {
    const writing = db.transaction(store, 'readwrite')
    for (const row of rows) writing.objectStore(store).put(row)
    writing.oncomplete = () => resolve()
    writing.onerror = () => reject(writing.error ?? new Error('not written'))
  })
}

async function names(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap((one) => (one.name ? [one.name] : []))
}

const notes = (db: IDBDatabase) => {
  db.createObjectStore('files', { keyPath: 'path' })
  db.createObjectStore('assets', { keyPath: 'path' })
  db.createObjectStore('meta')
  db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex(
    'notePath',
    'notePath',
  )
  db.createObjectStore('stats', { keyPath: 'path' })
}

describe('what an older version kept in this browser under nib', () => {
  test('is the notes the app opens, and the old store is gone after', async () => {
    const old = await opened('nib', 2, notes)
    await written(old, 'files', [
      { path: '/t/kept.md', content: '# kept', modified: 1, created: 1 },
    ])
    old.close()

    expect(await files.get('/t/kept.md')).toMatchObject({ content: '# kept' })
    expect(await names()).not.toContain('nib')
  })

  test('fills in what the new store lacks and never writes over what it has', async () => {
    const now = await opened('carry-to', 2, notes)
    await written(now, 'files', [{ path: '/b.md', content: 'newer', modified: 2, created: 1 }])
    now.close()
    const old = await opened('carry-from', 2, notes)
    await written(old, 'files', [
      { path: '/b.md', content: 'older', modified: 1, created: 1 },
      { path: '/c.md', content: 'only old', modified: 1, created: 1 },
    ])
    old.close()

    await carryDatabase('carry-from', 'carry-to')

    const db = await opened('carry-to', 2, () => undefined)
    const rows = await new Promise<unknown[]>((resolve) => {
      const asked = db.transaction('files').objectStore('files').getAll()
      asked.onsuccess = () => resolve(asked.result)
    })
    db.close()
    expect(rows).toMatchObject([
      { path: '/b.md', content: 'newer' },
      { path: '/c.md', content: 'only old' },
    ])
    expect(await names()).not.toContain('carry-from')
  })

  test('keeps a sync store, its device and its rows', async () => {
    const first = await openWeb('former')
    const device = first.opened.device
    await first.write([put('files', { hash: 'h', state: 'here' })])
    await first.close()
    await carryDatabase('orden-sync:former', 'nib-sync:former')
    expect(await names()).toContain('nib-sync:former')

    expect(await deviceWeb('former')).toBe(device)
    const again = await openWeb('former')
    expect(again.opened.device).toBe(device)
    expect((await again.read([get('files', 'h')]))[0]).toMatchObject({
      hash: 'h',
    })
    await again.close()
    expect(await names()).not.toContain('nib-sync:former')

    await carryDatabase('orden-sync:former', 'nib-sync:former')
    await forgetWeb('former')
    expect(await names()).not.toContain('nib-sync:former')
    expect(await names()).not.toContain('orden-sync:former')
  })

  test('leaves no tab of an older version leading beside a new one', async () => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks
    expect(locks, 'Web Locks need Node 24').toBeDefined()
    const leading = await leadSync(undefined, 'acct')
    const older = await locks?.request('nib-sync:acct', { ifAvailable: true }, (lock) => lock)
    expect(older).toBeNull()
    leading?.release()
  })
})
