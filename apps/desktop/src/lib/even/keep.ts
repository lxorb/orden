import type { Vault } from '../accounts/src/api'
import { forget as forgetHere, keep as keepHere, storedText } from '../stored'
import { waited } from '../timing'
import { connectStore } from './sdk'

export interface Keep {
  readonly name: string
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<boolean>
  clear(key: string): Promise<void>
}

export const wrote = new Map<string, string>()
export const read = new Map<string, string>()

function some(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const page: Keep = {
  name: 'localStorage',
  read: (key) => Promise.resolve(some(storedText(key))),
  write: (key, value) => Promise.resolve(keepHere(key, value)),
  clear(key) {
    forgetHere(key)
    return Promise.resolve()
  },
}

const COOKIE_LIFE = 60 * 60 * 24 * 365

export function cookieOf(key: string): string | null {
  const found = document.cookie
    .split(';')
    .map((one) => one.trim())
    .find((one) => one.startsWith(`${key}=`))

  return some(found ? decodeURIComponent(found.slice(key.length + 1)) : null)
}

export function writeCookie(key: string, value: string): void {
  document.cookie = `${key}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_LIFE};samesite=lax`
}

const cookie: Keep = {
  name: 'cookie',
  read: (key) => Promise.resolve(cookieOf(key)),
  write(key, value) {
    writeCookie(key, value)
    return Promise.resolve(true)
  },
  clear(key) {
    document.cookie = `${key}=;path=/;max-age=0`
    return Promise.resolve()
  },
}

const shelf: Keep = {
  name: 'indexedDB',
  async read(key) {
    const { meta } = await import('../web/store')
    return some(await meta.get(key))
  },
  async write(key, value) {
    const { meta } = await import('../web/store')
    await meta.put(key, value)
    return true
  },
  async clear(key) {
    const { meta } = await import('../web/store')
    await meta.remove(key)
  },
}

export const hostKeep: Keep = {
  name: 'host',
  async read(key) {
    return some(await (await connectStore())?.read(key))
  },
  async write(key, value) {
    const store = await connectStore()
    if (!store) return false

    for (const pause of [0, 200, 600]) {
      if (pause) await waited(pause)
      if (await store.write(key, value)) return true
    }

    return false
  },
  async clear(key) {
    await (await connectStore())?.write(key, '')
  },
}

export const THIS_PAGE: readonly Keep[] = [page, cookie, shelf]

const KEEPS: readonly Keep[] = [...THIS_PAGE, hostKeep]

const SESSION = 'orden:session'

export interface Held {
  name: string
  value: string | null
  failed: boolean
}

export async function readAll(key: string, from: readonly Keep[] = KEEPS): Promise<Held[]> {
  return Promise.all(
    from.map(async (keep) => {
      try {
        const value = await keep.read(key)
        if (key === SESSION) read.set(keep.name, value === null ? 'nothing' : 'a token')
        return { name: keep.name, value, failed: false }
      } catch (error) {
        if (key === SESSION) read.set(keep.name, `threw ${String(error).slice(0, 40)}`)
        return { name: keep.name, value: null, failed: true }
      }
    }),
  )
}

async function writeAll(key: string, value: string): Promise<void> {
  await Promise.all(
    KEEPS.map(async (keep) => {
      try {
        const kept = await keep.write(key, value)
        if (key === SESSION) wrote.set(keep.name, kept ? 'kept' : 'refused')
      } catch (error) {
        if (key === SESSION) wrote.set(keep.name, `threw ${String(error).slice(0, 40)}`)
      }
    }),
  )
}

async function clearAll(key: string): Promise<void> {
  await Promise.all(KEEPS.map((keep) => keep.clear(key).catch(() => undefined)))
}

const SEEDED = 'orden:seeded'

export const seedFlag = {
  async read() {
    return (await readAll(SEEDED)).some((one) => one.value === 'yes')
  },
  async write() {
    await writeAll(SEEDED, 'yes')
  },
}

export const everywhere: Vault = {
  async read() {
    const held = await readAll(SESSION)
    const found = held.find((one) => one.value !== null)?.value ?? null
    if (!found) return null

    if (held.some((one) => one.value === null)) void writeAll(SESSION, found)

    return found
  },

  write: (token) => writeAll(SESSION, token),
  clear: () => clearAll(SESSION),
}
