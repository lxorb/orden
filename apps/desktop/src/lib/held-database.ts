export interface HeldDatabase {
  transaction(
    stores: string | readonly string[],
    mode?: IDBTransactionMode,
  ): Promise<IDBTransaction>
  close(): void
}

type Upgrade = (request: IDBOpenDBRequest, oldVersion: number) => void

export function heldDatabase(name: string, version: number, upgrade: Upgrade): HeldDatabase {
  let open: Promise<IDBDatabase> | null = null

  const lost = (was: Promise<IDBDatabase>) => {
    if (open === was) open = null
  }

  const database = (): Promise<IDBDatabase> => {
    if (open) return open
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = (event) => upgrade(request, event.oldVersion)
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          lost(opening)
        }
        db.onclose = () => lost(opening)
        resolve(db)
      }
      request.onerror = () => {
        lost(opening)
        reject(request.error ?? new Error(`${name} did not open`))
      }
    })
    open = opening
    return opening
  }

  return {
    async transaction(stores, mode = 'readonly') {
      const names = typeof stores === 'string' ? stores : [...stores]
      const opening = database()
      const db = await opening
      try {
        return db.transaction(names, mode)
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error
        lost(opening)
        return (await database()).transaction(names, mode)
      }
    },
    close() {
      const was = open
      open = null
      void was?.then((db) => db.close()).catch(() => undefined)
    },
  }
}
