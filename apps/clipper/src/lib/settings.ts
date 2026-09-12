/** Everything the extension remembers, in one read.
 *
 *  `chrome.storage.local` is the only place a popup that lives for two seconds
 *  and a service worker that is stopped between clips can both look, so the
 *  session, the target and the two preferences live there under the same key
 *  names the app uses in `localStorage`. Nothing trusts what comes back: the
 *  keys were written by some version of this extension, possibly an older one.
 *
 *  One `get(null)` fetches the lot, which is what keeps the popup's first paint
 *  off the network and under a frame. */

import type { Space } from './api'
import { isRecord, isString, listOf, readSpace, text } from './stored'

export type Theme = 'system' | 'dark' | 'light'

interface Target {
  spaceId: string
  /** Relative to the space, `/`-separated. Empty means the space's own top. */
  folder: string
}

export interface Settings {
  token: string | null
  email: string | null
  /** The account's spaces as of the last look, so the picker has something to
   *  draw before `/v1/spaces` answers. */
  spaces: Space[]
  target: Target
  language: string
  theme: Theme
}

const KEYS = {
  token: 'nib:session',
  email: 'nib:email',
  spaces: 'nib:spaces',
  target: 'nib:target',
  language: 'nib:language',
  theme: 'nib:theme',
} as const

const THEMES: Theme[] = ['system', 'dark', 'light']

function readTarget(value: unknown): Target {
  if (!isRecord(value)) return { spaceId: '', folder: '' }

  return {
    spaceId: isString(value.spaceId) ? value.spaceId : '',
    folder: isString(value.folder) ? value.folder : '',
  }
}

function shape(held: Record<string, unknown>): Settings {
  const theme = held[KEYS.theme]

  return {
    token: text(held, KEYS.token),
    email: text(held, KEYS.email),
    spaces: listOf(held[KEYS.spaces], readSpace),
    target: readTarget(held[KEYS.target]),
    language: text(held, KEYS.language) ?? 'system',
    theme: THEMES.find((one) => one === theme) ?? 'system',
  }
}

export async function settings(): Promise<Settings> {
  return shape(await chrome.storage.local.get(null))
}

/** Writes only what is named. A patch rather than the whole object, because two
 *  surfaces write here: the popup remembers the target it just saved to while
 *  the options page may be open on the language. */
export async function remember(patch: Partial<Settings>): Promise<void> {
  const held: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(patch)) {
    const key = KEYS[name as keyof Settings]
    held[key] = value
  }

  await chrome.storage.local.set(held)
}

/** Signing out takes the session with it and leaves the preferences, which are
 *  about this browser rather than about the account. */
export async function forget(): Promise<void> {
  await chrome.storage.local.remove([KEYS.token, KEYS.email, KEYS.spaces])
}
