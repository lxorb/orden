/** Searching a space in the browser: the same walk the crate does on a desktop,
 *  over the rows in this browser's own storage.
 *
 *  The query arrives already parsed and the matching itself is shared code, so
 *  the two builds cannot answer differently; what differs is only where the
 *  notes are. Its own module rather than a case in commands.ts because it is
 *  what the search worker runs, and a worker that pulled in the whole command
 *  surface would pull the app in behind it. */

import { Fuzzy, type FuzzyHit, withoutWords } from '../search/fuzzy'
import { foldedOnce, type Hit, Matcher } from '../search/match'
import type { Query } from '../search/query'
import { basename, isMarkdown, normalise, within } from './paths'
import { files } from './store'

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
 *  inside a folder that is. The twin of `has` in workspace/excluded.svelte.ts and
 *  of `left_out` in search.rs. */
function leftOut(relative: string, excluded: readonly string[]): boolean {
  return excluded.some((one) => relative === one || relative.startsWith(`${one}/`))
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
  let found = 0
  let hits: Hit[] = []
  let loose: FuzzyHit[] = []

  // A cursor rather than the whole store: the rows come in path order, which is
  // the order the desktop walks a space in, and the first rows are on screen
  // while the last folder is still being read.
  await files.each((row) => {
    if (found >= limit) return
    if (!within(base, row.path) || !isMarkdown(row.path)) return

    const relative = row.path.slice(base === '/' ? 1 : base.length + 1)
    if (leftOut(relative, excluded)) return

    const note = {
      path: row.path,
      relative,
      name: basename(row.path),
      body: row.content,
      // Both passes below read the note; this is what keeps them to one folded
      // copy of it between them. See `foldedOnce` in search/match.ts.
      folded: foldedOnce(row.content),
    }

    const exact = matcher.hits(note, limit - found)
    if (exact.length) {
      found += exact.length
      hits.push(...exact)
      if (hits.length >= BATCH) {
        onFound({ hits, loose: [] })
        hits = []
      }
      return
    }

    // Only a note the query does not answer is worth guessing about, which is
    // also what keeps the loose pass off every note that already has a row.
    if (narrowed?.spans(note) == null) return

    const guess = fuzzy.best(note)
    if (guess) loose.push(guess)
    // Kept to the best of them as the walk goes, so a space where everything
    // matches loosely does not become a list of the whole space. Trimmed at
    // twice the limit rather than at it, so the sort happens once in a while
    // rather than once a note.
    if (loose.length > limit * 2) loose = best(loose, limit)
  })

  onFound({ hits, loose: best(loose, limit) })
}

/** The `most` best-scoring of them, highest first. */
function best(loose: FuzzyHit[], most: number): FuzzyHit[] {
  return loose.sort((a, b) => b.score - a.score).slice(0, most)
}
