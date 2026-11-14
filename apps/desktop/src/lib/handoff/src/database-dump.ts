interface IndexShape {
  name: string
  keyPath: string | string[]
  unique: boolean
  multiEntry: boolean
}

interface StoreDump {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: IndexShape[]
  keys: IDBValidKey[]
  values: unknown[]
}

export interface DatabaseDump {
  name: string
  version: number
  stores: StoreDump[]
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the database refused'))
  })
}

export function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('the write failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('the write was abandoned'))
  })
}

export function existing(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function dump(name: string): Promise<DatabaseDump | null> {
  const db = await existing(name)
  if (!db) return null

  try {
    const names = [...db.objectStoreNames]
    if (names.length === 0) return { name, version: db.version, stores: [] }

    const reading = db.transaction(names, 'readonly')
    const stores = await Promise.all(
      names.map(async (storeName) => {
        const store = reading.objectStore(storeName)
        const indexes = [...store.indexNames].map((indexName) => {
          const index = store.index(indexName)
          return {
            name: indexName,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          }
        })
        const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())])
        return {
          name: storeName,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes,
          keys,
          values,
        }
      }),
    )
    return { name, version: db.version, stores }
  } finally {
    db.close()
  }
}

export function shaped(request: IDBOpenDBRequest, database: DatabaseDump): void {
  const db = request.result
  const change = request.transaction
  for (const shape of database.stores) {
    const store = db.objectStoreNames.contains(shape.name)
      ? change?.objectStore(shape.name)
      : db.createObjectStore(shape.name, {
          keyPath: shape.keyPath,
          autoIncrement: shape.autoIncrement,
        })
    for (const index of shape.indexes) {
      if (store && !store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, {
          unique: index.unique,
          multiEntry: index.multiEntry,
        })
      }
    }
  }
}
