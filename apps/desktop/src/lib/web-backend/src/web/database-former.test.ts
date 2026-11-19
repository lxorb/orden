import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'
import { carryDatabase } from './carry-database'

const dumped = vi.hoisted((): string[] => [])

vi.mock('../../../handoff/src/api', async (real) => {
  const handoff = await real<typeof import('../../../handoff/src/api')>()
  return {
    ...handoff,
    dump: (name: string) => {
      dumped.push(name)
      return handoff.dump(name)
    },
  }
})
import { files } from './store'

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
  db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex('notePath', 'notePath')
  db.createObjectStore('stats', { keyPath: 'path' })
}

describe('what an older version kept in this browser under nib', () => {
  test('is the notes the app opens, and the old store is gone after', async () => {
    const old = await opened('nib', 2, notes)
    await written(old, 'files', [{ path: '/t/kept.md', content: '# kept', modified: 1, created: 1 }])
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

  test('takes what the older store changed later, and keeps a snapshot whose number the new store gave to another', async () => {
    const now = await opened('split-to', 2, notes)
    await written(now, 'files', [{ path: '/a.md', content: 'carried', modified: 1, created: 1 }])
    await written(now, 'snapshots', [{ id: 1, notePath: '/a.md', content: 'new tab', taken_at: 5, size: 7 }])
    now.close()
    const old = await opened('split-from', 2, notes)
    await written(old, 'files', [{ path: '/a.md', content: 'edited in the older tab', modified: 9, created: 1 }])
    await written(old, 'snapshots', [{ id: 1, notePath: '/a.md', content: 'older tab', taken_at: 8, size: 9 }])
    old.close()

    await carryDatabase('split-from', 'split-to', () => Promise.resolve(true))
    await carryDatabase('split-from', 'split-to')

    const db = await opened('split-to', 2, () => undefined)
    const [rows, snapshots] = await Promise.all(
      ['files', 'snapshots'].map(
        (store) =>
          new Promise<unknown[]>((resolve) => {
            const asked = db.transaction(store).objectStore(store).getAll()
            asked.onsuccess = () => resolve(asked.result)
          }),
      ),
    )
    db.close()
    expect(rows).toMatchObject([{ path: '/a.md', content: 'edited in the older tab' }])
    expect(snapshots?.map((one) => (one as { content: string }).content).sort()).toEqual(['new tab', 'older tab'])
    expect(await names()).not.toContain('split-from')
  })
})

describe('a carry that checks its work', () => {
  test('lists what the new store holds by key, and never reads its values back', async () => {
    const old = await opened('read-from', 2, notes)
    await written(old, 'files', [{ path: '/a.md', content: 'a', modified: 1, created: 1 }])
    old.close()

    dumped.length = 0
    await carryDatabase('read-from', 'read-to')

    expect(dumped).not.toContain('read-to')
    expect(await names()).not.toContain('read-from')
  })
})

describe('a carry that does not finish', () => {
  test('leaves the app on the older store, where the notes are', async () => {
    const old = await opened('stuck-from', 2, notes)
    await written(old, 'files', [{ path: '/kept.md', content: 'kept', modified: 1, created: 1 }])
    old.close()
    const holding = await opened('stuck-to', 1, () => undefined)
    holding.onversionchange = () => undefined

    const { databaseName } = await import('./carry-database')
    const name = await databaseName('stuck-from', 'stuck-to', 'stuck-from')
    holding.close()

    expect(name).toBe('stuck-from')
    expect(await names()).toContain('stuck-from')
  })
})
