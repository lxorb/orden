/** The filter being made or changed, and the sheet that asks for it (FilterSheet.svelte),
 *  mounted the first time one is asked for: nothing of it is in the first paint. */

import { mount } from 'svelte'

export interface Filtering {
  /** The filter's file, or null for a new one. */
  path: string | null
  name: string
  query: string
}

class FilterAsk {
  shown = $state.raw<Filtering | null>(null)
}

export const filterAsk = new FilterAsk()

let mounted = false

/** Asks for a filter: a new one, or the one in a file, as it was written. */
export function showFilter(ask: Filtering): void {
  filterAsk.shown = ask
  if (mounted) return
  mounted = true
  void import('./FilterSheet.svelte').then((one) => mount(one.default, { target: document.body }))
}
