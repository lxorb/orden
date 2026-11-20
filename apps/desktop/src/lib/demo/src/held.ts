import {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from 'fake-indexeddb'

export function holdDatabases(into: object): void {
  const held = {
    indexedDB: new IDBFactory(),
    IDBFactory,
    IDBKeyRange,
    IDBCursor,
    IDBCursorWithValue,
    IDBDatabase,
    IDBIndex,
    IDBObjectStore,
    IDBOpenDBRequest,
    IDBRequest,
    IDBTransaction,
    IDBVersionChangeEvent,
  }
  for (const [name, value] of Object.entries(held))
    Object.defineProperty(into, name, { configurable: true, enumerable: true, writable: true, value })
}
