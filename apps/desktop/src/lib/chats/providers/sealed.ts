import type { Sealed } from '@orden/chats/provider'
import { secretName } from '@orden/chats/provider'
import { heldDatabase, type HeldDatabase } from '../../held-database'

export interface Vault {
  read(name: string): Promise<string | null>
  write(name: string, value: string | null): Promise<void>
}

interface Row {
  iv: Uint8Array
  data: ArrayBuffer
}

const STORE = 'sealed'

export function sealedDatabase(): HeldDatabase {
  return heldDatabase('orden-chat-sealed', 1, (request) => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
  })
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the device store failed'))
  })
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const one of bytes) text += String.fromCharCode(one)
  return btoa(text)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (one) => one.charCodeAt(0))
}

export function keyName(name: string): string {
  return secretName('sealed', name, 'key')
}

function key(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw.slice(), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function sealedStore(vault: Vault, db: HeldDatabase = sealedDatabase()): Sealed {
  const row = async (name: string): Promise<Row | undefined> => {
    const store = (await db.transaction(STORE)).objectStore(STORE)
    return (await done(store.get(name))) as Row | undefined
  }
  const put = async (name: string, value: Row | null): Promise<void> => {
    const store = (await db.transaction(STORE, 'readwrite')).objectStore(STORE)
    if (value === null) await done(store.delete(name))
    else await done(store.put(value, name))
  }
  return {
    async read(name) {
      try {
        const kept = await vault.read(keyName(name))
        if (!kept) return null
        const found = await row(name)
        if (!found) return null
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: found.iv.slice() },
          await key(fromBase64(kept)),
          found.data,
        )
        return new Uint8Array(plain)
      } catch {
        return null
      }
    },
    async write(name, bytes) {
      if (bytes === null) {
        await put(name, null)
        await vault.write(keyName(name), null)
        return
      }
      let kept = await vault.read(keyName(name))
      if (!kept) {
        kept = toBase64(crypto.getRandomValues(new Uint8Array(32)))
        await vault.write(keyName(name), kept)
      }
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await key(fromBase64(kept)),
        bytes.slice(),
      )
      await put(name, { iv, data })
    },
  }
}
