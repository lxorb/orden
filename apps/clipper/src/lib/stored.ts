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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A string under `key`, or null for anything else. */
export function text(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const one = value[key]
  return isString(one) ? one : null
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
