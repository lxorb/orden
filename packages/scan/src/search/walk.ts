import { Fuzzy, type FuzzyHit, withoutWords } from './fuzzy'
import { type Hit, Matcher, type SearchNote } from './match'
import type { Query } from './query'

const BATCH = 24

export interface Found {
  hits: Hit[]
  loose: FuzzyHit[]
}

function leftOut(relative: string, excluded: ReadonlySet<string>): boolean {
  if (!excluded.size) return false
  if (excluded.has(relative)) return true

  for (let at = relative.lastIndexOf('/'); at > 0; at = relative.lastIndexOf('/', at - 1)) {
    if (excluded.has(relative.slice(0, at))) return true
  }

  return false
}

export async function walkSearch(
  each: (visit: (note: SearchNote) => boolean) => Promise<void>,
  query: Query,
  terms: readonly string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(terms)
  const narrowed = terms.length ? new Matcher(withoutWords(query)) : null
  const left = new Set(excluded)
  let found = 0
  let hits: Hit[] = []
  let loose: FuzzyHit[] = []

  await each((note) => {
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

    if (narrowed?.spans(note) == null) return true

    const guess = fuzzy.best(note)
    if (guess) loose.push(guess)
    if (loose.length > limit * 2) loose = best(loose, limit)
    return true
  })

  onFound({ hits, loose: best(loose, limit) })
}

function best(loose: FuzzyHit[], most: number): FuzzyHit[] {
  return loose.sort((a, b) => b.score - a.score).slice(0, most)
}
