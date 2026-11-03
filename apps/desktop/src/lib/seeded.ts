/** Whether this device has already been given the welcome note.
 *
 *  A different question from "is there anything here", and the difference is the
 *  bug: a reader who deleted every note has been introduced, and handing them the
 *  welcome note again - and, signed in, pushing it into their account - is the app
 *  forgetting it has met them. Emptiness was the only test there was.
 *
 *  A module rather than a line because of one place. A packed plugin is served
 *  from a local port that is picked afresh every launch, so its `localStorage` is
 *  somebody else's on every launch and every launch reads as the first. The page's
 *  own store answers everywhere else; the plugin hands over one that survives a
 *  launch, the way it does for the session token. See even/keep.ts, and see
 *  welcome.ts for the whole of what went wrong. */

import { forget, keep, storedText } from './stored'

const KEY = 'nib:seeded'

/** A store that outlives a launch where the page's own does not. */
export interface Remembers {
  read(): Promise<boolean>
  write(): Promise<void>
}

let elsewhere: Remembers | null = null

/** Said once, by a host whose page storage does not last. */
export function rememberSeedIn(store: Remembers): void {
  elsewhere = store
}

/** Only for the tests, which run several devices in one process. */
export function forgetSeedStore(): void {
  elsewhere = null
}

export async function wasSeeded(): Promise<boolean> {
  // The page's own store, which is every browser and every desktop.
  if (storedText(KEY) === 'yes') return true

  try {
    return (await elsewhere?.read()) ?? false
  } catch {
    // A store that throws is a store that was not there, which is the same
    // answer as one that never kept it.
    return false
  }
}

export async function markSeeded(): Promise<void> {
  // One store failing is why there are two.
  keep(KEY, 'yes')
  await elsewhere?.write().catch(() => undefined)
}

/** Where the space a first visit was given is, by its root: the one the fresh start
 *  made (first-space.svelte.ts), or the browser's `/Notes` its seed went into. Half of
 *  what makes it the default space rather than one of the reader's own, whatever either
 *  is called; the other half is what it holds (seed-space.ts). A space renamed has
 *  another root, and is the reader's from then on (#1077). */
const SPACE_KEY = 'nib:seed-space'

export function markSeedSpace(root: string): void {
  keep(SPACE_KEY, root)
}

export function seedSpaceRoot(): string | null {
  return storedText(SPACE_KEY)
}

/** Said once the default space has gone, or become one of the account's. */
export function forgetSeedSpace(): void {
  forget(SPACE_KEY)
}
