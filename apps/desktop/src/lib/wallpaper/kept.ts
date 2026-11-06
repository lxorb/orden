const NAME = 'nib-wallpaper'
const STORE = 'picture'

export type Copy = 'source' | 'source-dark'

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  open ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the wallpaper store did not open'))
  })
  open.catch(() => (open = null))
  return open
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the wallpaper store refused'))
  })
}

async function asked<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database()
  return settled(ask(db.transaction(STORE, mode).objectStore(STORE)))
}

export async function keepSource(picture: Blob, key: Copy = 'source'): Promise<boolean> {
  try {
    await asked('readwrite', (store) => store.put(picture, key))
    return true
  } catch {
    return false
  }
}

export async function keptSource(key: Copy = 'source'): Promise<Blob | null> {
  try {
    const found: unknown = await asked('readonly', (store) => store.get(key))
    return found instanceof Blob ? found : null
  } catch {
    return null
  }
}

export async function forgetSource(key: Copy = 'source'): Promise<void> {
  try {
    await asked('readwrite', (store) => store.delete(key))
  } catch {
    // Nothing kept is what was asked for.
  }
}
