/** What this device calls itself, for the account to say where something came
 *  from.
 *
 *  Two things read it: a version kept on the account, which says which device
 *  wrote those words, and the sync log, which says which device a pass belongs
 *  to. Both are answering the same question - "was that me, or the laptop?" -
 *  and neither is worth a setting: what somebody wants to see there is the kind
 *  of machine, and the kind of machine is something the app can tell.
 *
 *  Kept once it has been worked out, so a phone that reports itself differently
 *  after an update does not become a second device in the list. */

import { isMobile, isNative } from './tauri'

const STORAGE_KEY = 'nib:device'

/** As long as the account keeps; see versions.ts. */
const LONGEST = 40

let held: string | null = null

/** The words, from what the platform says and nothing else: no serial, no
 *  fingerprint, nothing that outlives this account's own storage. */
function worked(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent

  const system = /Windows/i.test(agent)
    ? 'Windows'
    : /Android/i.test(agent)
      ? 'Android'
      : /iPhone|iPad/i.test(agent)
        ? 'iOS'
        : /Mac OS X|Macintosh/i.test(agent)
          ? 'Mac'
          : /Linux/i.test(agent)
            ? 'Linux'
            : ''

  const shape = isNative ? (isMobile ? 'phone' : 'desktop') : 'browser'

  return [system, shape].filter(Boolean).join(' ').slice(0, LONGEST)
}

export function deviceName(): string {
  if (held !== null) return held

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      held = saved.slice(0, LONGEST)
      return held
    }
  } catch {
    // A browser with storage turned off still syncs; it just says less.
  }

  held = worked() || 'a device'
  try {
    localStorage.setItem(STORAGE_KEY, held)
  } catch {
    // Nothing to do about it, and nothing depends on it being kept.
  }

  return held
}

/** For a test that wants a name of its own. */
export function nameDevice(name: string) {
  held = name.slice(0, LONGEST)
}
