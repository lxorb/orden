import { isRecord, isString, stored } from './stored'

export function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([one]) => one !== key))
}

export function filledIn<T>(
  record: Record<string, T>,
  from: Record<string, T>,
): Record<string, T> | null {
  const missing = Object.entries(from).filter(([key]) => record[key] === undefined)
  return missing.length ? { ...record, ...Object.fromEntries(missing) } : null
}

export function withOrWithout<T>(
  record: Record<string, T>,
  key: string,
  value: T | null,
): Record<string, T> {
  return value === null ? without(record, key) : { ...record, [key]: value }
}

export interface Folded {
  account: string | null
}

export function readSpaces<T>(
  key: string,
  own: (one: Record<string, unknown>) => T,
): Record<string, T & Folded> {
  const saved = stored(key)
  if (!isRecord(saved)) return {}

  const out: Record<string, T & Folded> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = { ...own(one), account: isString(one.account) ? one.account : null }
  }

  return out
}

export interface Folding<T> {
  fold: (theirs: T, mine: T) => T
  same: (one: T, other: T) => boolean
}

export function meet<T>(
  held: (Folded & { sent?: boolean }) | undefined,
  accountId: string,
  mine: T,
  theirs: T,
  { fold, same }: Folding<T>,
): { value: T; tell: boolean } | null {
  const ours = held?.account !== accountId || held.sent === false
  const value = ours ? fold(theirs, mine) : theirs

  if (held && !ours && same(mine, value)) return null

  return { value, tell: ours && !same(value, theirs) }
}
