import type { Host } from '../provider'
import { secretName } from '../provider'

export interface RawStore {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, value: Uint8Array | null): Promise<void>
  drop(prefix: string): Promise<void>
}

export interface Kept {
  read<T>(name: string): Promise<T | null>
  write(name: string, value: unknown): Promise<void>
  bytes(name: string): Promise<Uint8Array | null>
  keepBytes(name: string, bytes: Uint8Array | null): Promise<void>
  forget(): Promise<void>
}

const SALT = new TextEncoder().encode('orden signal kept')

function keyName(account: string): string {
  return secretName('signal', account, 'kept')
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((one) => one.toString(16).padStart(2, '0')).join('')
}

export function memoryStore(): RawStore & { rows: Map<string, Uint8Array> } {
  const rows = new Map<string, Uint8Array>()
  return {
    rows,
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    put(key, value) {
      if (value === null) rows.delete(key)
      else rows.set(key, value)
      return Promise.resolve()
    },
    drop(prefix) {
      for (const key of [...rows.keys()]) if (key.startsWith(prefix)) rows.delete(key)
      return Promise.resolve()
    },
  }
}

async function master(host: Host, account: string): Promise<Uint8Array | null> {
  const sealed = host.sealed
  if (!sealed) return null
  const name = keyName(account)
  const kept = await sealed.read(name)
  if (kept?.length === 32) return kept
  const made = crypto.getRandomValues(new Uint8Array(32))
  await sealed.write(name, made)
  return made
}

export async function keptFor(raw: RawStore, host: Host, account: string): Promise<Kept> {
  const prefix = `${keyName(account)}:`
  const secret = await master(host, account).catch(() => null)
  if (!secret) {
    const memory = new Map<string, unknown>()
    return {
      read: <T>(name: string) => Promise.resolve((memory.get(name) as T | undefined) ?? null),
      write(name, value) {
        memory.set(name, value)
        return Promise.resolve()
      },
      bytes: (name) => Promise.resolve((memory.get(name) as Uint8Array | undefined) ?? null),
      keepBytes(name, bytes) {
        if (bytes === null) memory.delete(name)
        else memory.set(name, bytes)
        return Promise.resolve()
      },
      forget() {
        memory.clear()
        return Promise.resolve()
      },
    }
  }
  const base = await crypto.subtle.importKey('raw', secret.slice(), 'HKDF', false, ['deriveKey'])
  const derive = (info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, uses: KeyUsage[]) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: new TextEncoder().encode(info) },
      base,
      algorithm,
      false,
      uses,
    )
  const seal = await derive('seal', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt'])
  const names = await derive('names', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign'])
  const row = async (name: string) =>
    prefix + hex(await crypto.subtle.sign('HMAC', names, new TextEncoder().encode(name)))
  const open = async (name: string): Promise<Uint8Array | null> => {
    const found = await raw.get(await row(name))
    if (!found || found.length < 13) return null
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: found.slice(0, 12) },
        seal,
        found.slice(12),
      )
      return new Uint8Array(plain)
    } catch {
      return null
    }
  }
  const close = async (name: string, bytes: Uint8Array | null): Promise<void> => {
    const key = await row(name)
    if (bytes === null) {
      await raw.put(key, null)
      return
    }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, seal, bytes.slice())
    const out = new Uint8Array(12 + data.byteLength)
    out.set(iv)
    out.set(new Uint8Array(data), 12)
    await raw.put(key, out)
  }
  return {
    async read<T>(name: string): Promise<T | null> {
      const plain = await open(name)
      if (!plain) return null
      try {
        return JSON.parse(new TextDecoder().decode(plain)) as T
      } catch {
        return null
      }
    },
    write: (name, value) =>
      close(
        name,
        value === null || value === undefined
          ? null
          : new TextEncoder().encode(JSON.stringify(value)),
      ),
    bytes: open,
    keepBytes: close,
    async forget() {
      await raw.drop(prefix)
      await host.sealed?.write(keyName(account), null)
    },
  }
}
