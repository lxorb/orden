/** Searching a space in the browser: the same walk the crate does on a desktop,
 *  over the notes the worker is holding.
 *
 *  The query arrives already parsed and the matching itself is shared code, so
 *  the two builds cannot answer differently; what differs is only where the
 *  notes are. Its own module rather than a case in commands.ts because it is
 *  what the search worker runs, and a worker that pulled in the whole command
 *  surface would pull the app in behind it.
 *
 *  Where the notes come from is space-cache.ts: from memory once the space has
 *  been read, and from the store while it has not. Either way they arrive in path
 *  order, which is the order the desktop walks a space in, so the two builds fill
 *  a list the same way. */

import { Fuzzy, type FuzzyHit, withoutWords } from '../search/fuzzy'
import { type Hit, Matcher } from '../search/match'
import type { Query } from '../search/query'
import { normalise } from './paths'
import { space } from './space-cache'

/** How many hits are worth handing over at once. The same handful the Rust side
 *  sends, so a list fills the same way on both. */
const BATCH = 24

export interface Found {
  /** Hits that answer the query as asked, in the order the notes were read. */
  hits: Hit[]
  /** Notes that answer it only loosely, each with its best line and a score.
   *  Only ever in the last handful: a guess is worth showing in the order the
   *  scores put it, and the scores are not all in until the space has been
   *  read. */
  loose: FuzzyHit[]
}

/** Searches every note under `root`, handing hits over as they are found.
 *
 *  `terms` are the query's bare words, to be matched loosely against notes the
 *  query itself does not answer; empty when the query is not one to relax. See
 *  fuzzy.ts, and search.rs for the twin of this walk. */
/** Whether a note is one the space leaves out: the path itself, or something
 *  inside a folder that is.
 *
 *  Asked of the note's own ancestors rather than of the list, so leaving things out
 *  costs a handful of lookups per note however long the list is. The other way
 *  round it was one string comparison per excluded path per note, which at two
 *  hundred paths and five thousand notes was a million of them and showed up in the
 *  drive as a search that got slower the more it was asked to skip.
 *
 *  The twin of `has` in workspace/excluded.svelte.ts and of `left_out` in
 *  search.rs. */
function leftOut(relative: string, excluded: ReadonlySet<string>): boolean {
  if (!excluded.size) return false
  if (excluded.has(relative)) return true

  for (let at = relative.lastIndexOf('/'); at > 0; at = relative.lastIndexOf('/', at - 1)) {
    if (excluded.has(relative.slice(0, at))) return true
  }

  return false
}

export async function searchRows(
  root: string,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  /** The notes and folders the space leaves out, relative to it. Skipped before
   *  the row is read, which is the whole point of leaving one out; the crate's
   *  walk skips them the same way. See workspace/excluded.svelte.ts. */
  excluded: readonly string[] = [],
): Promise<void> {
  const base = normalise(root)
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(terms)
  // What a note has to answer before its lines are worth guessing about: the
  // query with its bare words taken out. A query of nothing but words leaves
  // nothing to answer, which every note does.
  const narrowed = terms.length ? new Matcher(withoutWords(query)) : null
  const left = new Set(excluded)
  let found = 0
  let hits: Hit[] = []
  let loose: FuzzyHit[] = []

  // Note by note rather than the whole space at once: the first rows are on
  // screen while the last folder is still being read, and a query that has found
  // its fill stops the walk where it stands. A note carries its own folded copy
  // and its own line index, so the two passes below share one of each and a
  // second search over the same note makes neither again; see `Held` in
  // space-cache.ts and `foldedOnce` in search/match.ts.
  await space.each(base, (note) => {
    if (found >= limit) return false
    if (leftOut(note.relative, left)) return true

    const exact = matcher.hits(note, limit - found)
    if (exact.length) {
      found += exact.length
      hits.push(...exact)
      if (hits.length >= BATCH) {
        onFound({ hits, loose: [] })
        hits = []
      }
      return true
    }

    // Only a note the query does not answer is worth guessing about, which is
    // also what keeps the loose pass off every note that already has a row.
    if (narrowed?.spans(note) == null) return true

    const guess = fuzzy.best(note)
    if (guess) loose.push(guess)
    // Kept to the best of them as the walk goes, so a space where everything
    // matches loosely does not become a list of the whole space. Trimmed at
    // twice the limit rather than at it, so the sort happens once in a while
    // rather than once a note.
    if (loose.length > limit * 2) loose = best(loose, limit)
    return true
  })

  onFound({ hits, loose: best(loose, limit) })
}

/** The `most` best-scoring of them, highest first. */
function best(loose: FuzzyHit[], most: number): FuzzyHit[] {
  return loose.sort((a, b) => b.score - a.score).slice(0, most)
}
