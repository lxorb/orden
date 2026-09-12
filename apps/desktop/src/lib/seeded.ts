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

import { keep } from './stored'

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

/** The page's own store, which is every browser and every desktop. Wrapped
 *  because a page with site data blocked throws rather than answering. */
function here(): boolean {
  try {
    return localStorage.getItem(KEY) === 'yes'
  } catch {
    return false
  }
}

export async function wasSeeded(): Promise<boolean> {
  if (here()) return true

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
