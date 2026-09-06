/** Reading what an earlier run wrote down.
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

/** An object that is not an array and not null, so its keys can be walked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The strings in a list, or nothing at all when it is not a list of them.
 *  Partly-good data is dropped whole: half a list of paths is not half useful,
 *  and a caller cannot tell which half it got. */
export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((one) => typeof one === 'string') ? (value as string[]) : null
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
