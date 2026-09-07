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
  write(key: string, value: string): Promise<void>
  clear(key: string): Promise<void>
}

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
    return Promise.resolve()
  },
  clear(key) {
    localStorage.removeItem(key)
    return Promise.resolve()
  },
}

/** A year, which is longer than any sitting and shorter than forever. */
const COOKIE_LIFE = 60 * 60 * 24 * 365

const cookie: Keep = {
  name: 'cookie',
  read(key) {
    const found = document.cookie
      .split(';')
      .map((one) => one.trim())
      .find((one) => one.startsWith(`${key}=`))

    return Promise.resolve(some(found ? decodeURIComponent(found.slice(key.length + 1)) : null))
  },
  write(key, value) {
    document.cookie = `${key}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_LIFE};samesite=lax`
    return Promise.resolve()
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
  },
  async clear(key) {
    const { meta } = await import('../web/store')
    await meta.remove(key)
  },
}

const host: Keep = {
  name: 'host',
  async read(key) {
    return some(await (await connectStore())?.read(key))
  },
  async write(key, value) {
    await (await connectStore())?.write(key, value)
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
const KEEPS: readonly Keep[] = [...THIS_PAGE, host]

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
        return { name: keep.name, value: await keep.read(key), failed: false }
      } catch {
        // A store that throws is a store that was not there.
        return { name: keep.name, value: null, failed: true }
      }
    }),
  )
}

async function writeAll(key: string, value: string): Promise<void> {
  await Promise.all(
    KEEPS.map((keep) =>
      keep.write(key, value).catch(() => {
        // One store failing is why there are four.
      }),
    ),
  )
}

async function clearAll(key: string): Promise<void> {
  await Promise.all(KEEPS.map((keep) => keep.clear(key).catch(() => undefined)))
}

const SESSION = 'nib:session'

/** The token, in every store that will have it. */
export const everywhere: Vault = {
  async read() {
    // The first store that kept it. They are asked together, so the slowest of
    // them is what this costs rather than the sum.
    return (await readAll(SESSION)).find((held) => held.value !== null)?.value ?? null
  },

  write: (token) => writeAll(SESSION, token),
  clear: () => clearAll(SESSION),
}
