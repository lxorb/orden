import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  said: null as string | null,
  asked: [] as string[],
  logged: [] as string[],
  kept: new Map<string, string>(),
}))

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: (command: string) => {
    calls.asked.push(command)
    return Promise.resolve(command === 'old_engine_databases' ? calls.said : null)
  },
  log: (_level: string, said: string) => void calls.logged.push(said),
  keep: (key: string, value: string) => {
    calls.kept.set(key, value)
    return true
  },
}))

const { added, carryOldDatabases, PASS_LEFT_BEHIND, revived } = await import('./old-engine')

function opened(name: string, version?: number, make?: (db: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => make?.(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('no'))
  })
}

async function all(name: string, store: string): Promise<[IDBValidKey[], unknown[]]> {
  const db = await opened(name)
  const reading = db.transaction(store).objectStore(store)
  const ask = <T>(request: IDBRequest<T>) =>
    new Promise<T>((resolve) => (request.onsuccess = () => resolve(request.result)))
  const out: [IDBValidKey[], unknown[]] = [
    await ask(reading.getAllKeys()),
    await ask(reading.getAll()),
  ]
  db.close()
  return out
}

const PASS = {
  name: 'orden-pass',
  version: 2,
  skipped: 0,
  stores: [
    {
      name: 'keyring',
      keyPath: null,
      autoIncrement: false,
      indexes: [],
      keys: ['this'],
      values: [{ keyring: { password: { sealed: 'U0VBTEVE' } }, rev: 4, pending: true }],
    },
    {
      name: 'files',
      keyPath: ['item', 'file', 'part'],
      autoIncrement: false,
      indexes: [],
      keys: [['i1', 'f1', 0]],
      values: [{ item: 'i1', file: 'f1', part: 0, bytes: { $orden: 'bytes', said: 'AQID+gD/' } }],
    },
  ],
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  calls.said = null
  calls.asked = []
  calls.logged = []
  calls.kept.clear()
})

describe('what the old engine kept in its databases', () => {
  test('comes back with its bytes, its undefined and its dates', () => {
    expect(
      revived({
        doc: { $orden: 'bytes', said: 'AQID+gD/' },
        nothing: { $orden: 'undefined', said: null },
        at: { $orden: 'date', said: 5 },
        list: [{ $orden: 'bytes', said: '' }, 'x'],
      }),
    ).toEqual({
      doc: new Uint8Array([1, 2, 3, 250, 0, 255]),
      nothing: undefined,
      at: new Date(5),
      list: [new Uint8Array(0), 'x'],
    })
  })

  test('is written into a database the new engine never made, shaped as it was', async () => {
    await added(PASS)
    const db = await opened('orden-pass')
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['files', 'keyring'])
    db.close()
    const [keys, values] = await all('orden-pass', 'keyring')
    expect(keys).toEqual(['this'])
    expect(values).toEqual([
      { keyring: { password: { sealed: 'U0VBTEVE' } }, rev: 4, pending: true },
    ])
    const [, files] = await all('orden-pass', 'files')
    expect((files[0] as { bytes: Uint8Array }).bytes).toEqual(
      new Uint8Array([1, 2, 3, 250, 0, 255]),
    )
  })

  test('never takes the place of what the new engine already wrote, and adds what it lacks', async () => {
    const db = await opened('orden-pass', 3, (made) => {
      made.createObjectStore('keyring')
      made.createObjectStore('device')
    })
    await new Promise<void>((resolve) => {
      const writing = db.transaction('keyring', 'readwrite')
      writing.objectStore('keyring').put({ fresh: true }, 'this')
      writing.oncomplete = () => resolve()
    })
    db.close()
    await added({
      ...PASS,
      stores: [
        { ...PASS.stores[0]!, keys: ['this', 'older'], values: [{ old: true }, { older: true }] },
      ],
    })
    const [keys, values] = await all('orden-pass', 'keyring')
    expect(keys).toEqual(['older', 'this'])
    expect(values).toEqual([{ older: true }, { fresh: true }])
    const again = await opened('orden-pass')
    expect(again.version).toBe(3)
    again.close()
  })

  test('is asked for once, said carried, and Pass is told when part of it stayed behind', async () => {
    calls.said = JSON.stringify([{ ...PASS, skipped: 1 }])
    await carryOldDatabases()
    expect(calls.asked).toEqual(['old_engine_databases', 'old_engine_databases_carried'])
    expect(calls.kept.get(PASS_LEFT_BEHIND)).toBe('1')
    expect(calls.logged.join('\n')).not.toContain('U0VBTEVE')
    const [keys] = await all('orden-pass', 'keyring')
    expect(keys).toEqual(['this'])
  })

  test('asks nothing more when the old engine left nothing', async () => {
    await carryOldDatabases()
    expect(calls.asked).toEqual(['old_engine_databases'])
    expect(calls.kept.size).toBe(0)
  })
})
