/** The one line between a base the reader wrote and one somebody else could have: see
 *  expr/pattern.ts in @orden/bases. Every path that answers a base from a file asks it
 *  here, when it answers, because whether a space is shared can change or be learned
 *  after the file was read. */

import { type Base, refusedPattern } from '@orden/bases'
import { trustsHtmlAt } from '../sharing.svelte'

/** The same copy for the same base, since an answer's work is kept with the object. */
const copies = new WeakMap<Base, Base>()

/** A base read at this path as it may run here: the reader's own as it is, anybody
 *  else's marked, or null where it holds a pattern it may not run. `stranger` is what
 *  a path cannot say: the fence stands in a file somebody shared on its own, which has
 *  none. */
export function guardedAt(base: Base, path: string | null, stranger = false): Base | null {
  if (!stranger && trustsHtmlAt(path)) return base
  if (refusedPattern(base) !== null) return null

  const known = copies.get(base)
  if (known) return known
  const copy = { ...base, guarded: true }
  copies.set(base, copy)
  return copy
}
