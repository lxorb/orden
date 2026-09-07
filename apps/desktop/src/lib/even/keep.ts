/** Somewhere to put a token that will still be there next launch.
 *
 *  A browser has one store and it lasts. A packed plugin is a page the phone app
 *  loads from files it holds, and nothing about that page's origin is promised:
 *  it may be a file, a custom scheme, or a local server on a port that is picked
 *  again every launch, and each of those is a different `localStorage` from the
 *  last one. Signing in and being signed out on the next launch is what that
 *  looks like from the outside.
 *
 *  So the token goes in all of them and comes back from whichever kept it. None
 *  of them is trusted, none of them is required, and a store that throws is a
 *  store that was not there. The phone app's own store is the one the platform
 *  documents as surviving, and it is also the only one that needs the bridge, so
 *  it is the one most likely to be missing when it is most wanted.
 *
 *  Nothing in the plain web build reaches this file. */

import type { Vault } from '../account.svelte'
import { connectStore } from './sdk'

/** One place a value can be kept. Every method answers rather than throws: a
 *  store that is not there is not an error, it is one fewer place to look. */
export interface Keep {
  readonly name: string
  read(key: string): Promise<string | null>
  /** Answers whether the value is now kept. A store that cannot say answers
   *  true: only the phone app's own store reports back. */
  write(key: string, value: string): Promise<boolean>
  clear(key: string): Promise<void>
}

/** What each store last did, so the diagnosis can say which one lost the token
 *  rather than only that it was lost. Written here because this is the only
 *  place that knows. */
export const wrote = new Map<string, string>()
export const read = new Map<string, string>()

/** Empty is the same as absent everywhere here: the phone app's store has no way
 *  to take a key away and reads a missing one as the empty string, so no store is
 *  allowed to answer with one. */
function some(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const page: Keep = {
  name: 'localStorage',
  read: (key) => Promise.resolve(some(localStorage.getItem(key))),
  write(key, value) {
    localStorage.setItem(key, value)
    return Promise.resolve(true)
  },
  clear(key) {
    localStorage.removeItem(key)
    return Promise.resolve()
  },
}

/** A year, which is longer than any sitting and shorter than forever. */
const COOKIE_LIFE = 60 * 60 * 24 * 365

/** A cookie's value, or null.
 *
 *  Synchronous and exported because it is the only durable store a packed
 *  plugin can read before it paints: a cookie is scoped to the host and ignores
 *  the port, so it is the same cookie however the local server was numbered this
 *  launch. See local.ts. */
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

/** The app's own database, which already holds the notes. Its own module opens
 *  it for files and assets; this asks for the same store the same way rather
 *  than opening a second database beside it. */
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
    // The one store that answers, and the one worth waiting for: `connectStore`
    // holds until the channel is on the page, so a write made while the phone
    // app was still starting lands rather than being lost.
    const store = await connectStore()
    if (!store) return false

    // The boolean is the whole contract. A host that refuses answers false and
    // says nothing else, and a caller that ignores it reports a session as kept
    // that will be gone on the next launch, which is what this whole file exists
    // to stop. Refusals are rare and transient enough to be worth three tries.
    for (const pause of [0, 200, 600]) {
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause))
      if (await store.write(key, value)) return true
    }

    return false
  },
  async clear(key) {
    // The phone app's store has no way to take a key away, so it is emptied.
    await (await connectStore())?.write(key, '')
  },
}

/** The stores that belong to the page. They answer at once, and whether they
 *  keep anything between launches is the whole question about a packed plugin's
 *  origin. */
export const THIS_PAGE: readonly Keep[] = [page, cookie, shelf]

/** Those, and the phone app's own, which is the only one the platform documents
 *  as surviving and the only one that has to wait for a channel. */
const KEEPS: readonly Keep[] = [...THIS_PAGE, hostKeep]

/** The one key this module exists for. */
const SESSION = 'nib:session'

/** What each store answered, for the diagnostics to show. A launch that comes
 *  back signed out should say which of the four forgot. */
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
        // A store that throws is a store that was not there.
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
        // One store failing is why there are four.
        if (key === SESSION) wrote.set(keep.name, `threw ${String(error).slice(0, 40)}`)
      }
    }),
  )
}

async function clearAll(key: string): Promise<void> {
  await Promise.all(KEEPS.map((keep) => keep.clear(key).catch(() => undefined)))
}

/** The token, in every store that will have it. */
export const everywhere: Vault = {
  async read() {
    // The first store that kept it. They are asked together, so the slowest of
    // them is what this costs rather than the sum.
    const held = await readAll(SESSION)
    const found = held.find((one) => one.value !== null)?.value ?? null
    if (!found) return null

    // Put it back into the ones that had lost it. A token that survived in only
    // one store is a token one wipe from being gone, and the store most likely
    // to be empty on a device is the one most likely to be asked first next
    // time. Nothing waits on this.
    if (held.some((one) => one.value === null)) void writeAll(SESSION, found)

    return found
  },

  write: (token) => writeAll(SESSION, token),
  clear: () => clearAll(SESSION),
}
