/** What the page and the search worker say to each other.
 *
 *  A module of its own so both ends read the same shapes from one place, and so
 *  the worker's own bundle carries nothing but this and the walk.
 *
 *  Every message is checked on arrival rather than cast. `postMessage` is a
 *  boundary like any other: what comes through it is unknown until something
 *  has looked. */

import type { FuzzyHit } from '../search/fuzzy'
import type { Hit } from '../search/match'
import type { Query } from '../search/query'
import type { Warmth } from '../search/warmth'

/** One search, asked. `id` is which search it is: typing outruns the storage,
 *  and answers to a word no longer in the field are dropped rather than shown. */
export interface Ask {
  kind: 'ask'
  id: number
  root: string
  query: Query
  /** The query's bare words, to be matched loosely; empty when the query is not
   *  one to relax. See fuzzy.ts. */
  terms: string[]
  limit: number
  /** The notes and folders the space leaves out, relative to it. Skipped before a
   *  row is read; see workspace/excluded.svelte.ts. */
  excluded: string[]
}

/** Read this space and keep it, so the first keystroke is not what pays for the
 *  reading. Sent at the search stage of the launch; see startup.svelte.ts and
 *  space-cache.ts. */
export interface Warm {
  kind: 'warm'
  root: string
}

export type Answer =
  | { kind: 'found'; id: number; hits: Hit[]; loose: FuzzyHit[] }
  | { kind: 'done'; id: number }
  /** What the worker is holding, whenever it has changed. The panel carries it as
   *  its `data-search` diagnostics; see search/warm.svelte.ts. */
  | { kind: 'warmth'; warmth: Warmth }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether a message is a search to run. The query is checked only as far as
 *  being an object: it was built by `parseQuery` on the other side of one
 *  `postMessage`, and the matcher answers nothing for a tree it cannot read
 *  rather than throwing. */
export function isAsk(value: unknown): value is Ask {
  if (!isRecord(value) || value.kind !== 'ask') return false

  return (
    typeof value.id === 'number' &&
    typeof value.root === 'string' &&
    typeof value.limit === 'number' &&
    isRecord(value.query) &&
    Array.isArray(value.terms) &&
    value.terms.every((one) => typeof one === 'string') &&
    Array.isArray(value.excluded) &&
    value.excluded.every((one) => typeof one === 'string')
  )
}

/** Whether a message is a space to warm. */
export function isWarm(value: unknown): value is Warm {
  return isRecord(value) && value.kind === 'warm' && typeof value.root === 'string'
}

/** Whether a message is an answer to one. */
export function isAnswer(value: unknown): value is Answer {
  if (!isRecord(value)) return false
  if (value.kind === 'warmth') return isRecord(value.warmth)
  if (typeof value.id !== 'number') return false
  if (value.kind === 'done') return true

  return value.kind === 'found' && Array.isArray(value.hits) && Array.isArray(value.loose)
}
