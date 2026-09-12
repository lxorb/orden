/** Reading what an earlier run wrote down, and writing it down for the next one.
 *
 *  Storage is not a type system. The string under a key was written by some
 *  version of this app - possibly an older one, possibly one interrupted
 *  halfway - and `JSON.parse` hands back whatever it finds without an opinion
 *  about it. Casting that to the shape the code wants is how a truncated entry
 *  turns into a crash three frames later, a long way from the read.
 *
 *  So nothing here trusts what it reads. `parsed` never throws, and each of the
 *  small checks below takes an unknown and answers with the shape it
 *  recognised, dropping whatever it did not. A missing entry and a corrupt one
 *  come back the same way, which is the only sensible answer to both. */

/** `JSON.parse` without the throw: null for missing text and for nonsense. */
export function parsed(text: string | null): unknown {
  if (text === null) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** What storage holds under `key`, parsed. Reading storage itself can throw -
 *  a browser told to allow no site data refuses the getter outright - so that
 *  is caught here too and reads as nothing written. */
export function stored(key: string): unknown {
  try {
    return parsed(localStorage.getItem(key))
  } catch {
    return null
  }
}

/** Writes one value down. Answers whether storage took it, and never throws.
 *
 *  Three ways a setter fails and not one of them is the caller's to handle: a
 *  browser told to keep no site data refuses the setter the way it refuses the
 *  getter above, a private window can have a quota of nothing, and a storage that
 *  is full throws on the write that would fill it. What follows in every case is
 *  that this machine forgets something between launches - never that what was being
 *  remembered did not happen, because the state itself is in memory and true. An
 *  unguarded setter turns all three into an exception in the middle of whatever was
 *  going on, which is how a full storage came to fail a whole syncing pass and, with
 *  it, the cursor that pass had just moved; see `save` in sync.svelte.ts.
 *
 *  The answer is there for the one caller that has something better to do than
 *  shrug: writing less beats writing nothing. Everyone else ignores it. */
export function keep(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** And forgetting one, which fails the same three ways and matters even less: a
 *  value that could not be removed is a value the next launch reads and drops. */
export function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do and nobody to tell.
  }
}

/** An object that is not an array and not null, so its keys can be walked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The strings in a list, or nothing at all when it is not a list of them.
 *  Partly-good data is dropped whole: half a list of paths is not half useful,
 *  and a caller cannot tell which half it got. */
export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((one) => typeof one === 'string') ? value : null
}

/** The entries of an object whose values pass `check`, with the rest left out.
 *  Here a bad entry is worth dropping on its own: these maps are keyed by path
 *  or by shortcut id, and one unreadable key says nothing about the others. */
export function recordOf<T>(value: unknown, check: (one: unknown) => one is T): Record<string, T> {
  if (!isRecord(value)) return {}

  const out: Record<string, T> = {}
  for (const [key, one] of Object.entries(value)) {
    if (check(one)) out[key] = one
  }

  return out
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
