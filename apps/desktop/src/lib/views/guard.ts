import { type Base, refusedPattern } from '@orden/bases'
import { trustsHtmlAt } from '../sharing.svelte'

const copies = new WeakMap<Base, Base>()

export function guardedAt(base: Base, path: string | null, stranger = false): Base | null {
  if (!stranger && trustsHtmlAt(path)) return base
  if (refusedPattern(base) !== null) return null

  const known = copies.get(base)
  if (known) return known
  const copy = { ...base, guarded: true }
  copies.set(base, copy)
  return copy
}
