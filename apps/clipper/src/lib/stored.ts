/** Reading what somebody else wrote down.
 *
 *  Four things hand this extension values it did not create: `chrome.storage`,
 *  `chrome.runtime.sendMessage`, `JSON.parse`, and the sync API's replies. None
 *  of them has an opinion about shape, and casting one to the type the code
 *  wants is how a half-written entry turns into a crash three frames later, a
 *  long way from the read. So each value is checked once, here, into a typed
 *  shape that the rest of the code may trust.
 *
 *  The app does the same in `apps/desktop/src/lib/stored.ts`; these are the few
 *  checks the clipper needs, under the same names. */

import type { Space } from './api'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A string under `key`, or null for anything else. */
export function text(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const one = value[key]
  return isString(one) ? one : null
}

/** One of the account's spaces, or null for a row that does not say what one is.
 *
 *  Two places are handed a space: the sync API answers with a list of them, and
 *  `chrome.storage` gives back the list that was remembered. Both used to read one
 *  for themselves and they had drifted - the stored reader wanted a finite
 *  position, the API's took any number, so a reply carrying a `NaN` came through
 *  one and not the other and the picker's order went with it. */
export function readSpace(value: unknown): Space | null {
  const id = text(value, 'id')
  const name = text(value, 'name')
  if (id === null || name === null) return null

  const position = isRecord(value) ? value.position : null
  return { id, name, position: isNumber(position) ? position : 0 }
}

/** `JSON.parse` without the throw: null for nonsense. */
export function parsed(source: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch {
    return null
  }
}

/** The members of a list that `read` recognises, with the rest left out. A page
 *  of spaces with one unreadable row is still a usable page of spaces. */
export function listOf<T>(value: unknown, read: (one: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []

  const out: T[] = []
  for (const one of value) {
    const kept = read(one)
    if (kept !== null) out.push(kept)
  }

  return out
}
