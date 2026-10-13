/** A colour row's two colours of the reader's own (glass's pair, glass/pairs.ts): which
 *  values are such a pair, the two colours any of the row's values shows as, and two
 *  picked as the value kept. Types only, so the settings in front of the first paint
 *  carry none of it. */

import type { Scheme } from '../theme.svelte'

export interface OwnPair {
  accepts(held: string): boolean
  colours(held: string, scheme: Scheme): readonly [string, string]
  of(first: string, second: string): string
}
