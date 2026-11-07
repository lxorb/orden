import { foldName } from '@orden/markdown/links'

export function fuzzy(query: string, text: string): number | null {
  return query ? foldedFuzzy(foldName(query), text) : 0
}

function foldedFuzzy(folded: string, text: string): number | null {
  const score = walked(folded, foldName(text), 0)
  return score === null ? null : score - Math.floor(text.length / 12)
}

export function walked(needle: string, haystack: string, first: number, at?: number[]) {
  let score = 0
  let cursor = first
  let previous = -2

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor)
    if (found < 0) return null

    if (found === previous + 1) score += 8
    if (found === 0 || /[\s/\\_.-]/.test(haystack.charAt(found - 1))) score += 6
    score -= Math.min(found - cursor, 12)

    at?.push(found)
    previous = found
    cursor = found + 1
  }

  return score
}

export function fuzzyAny(query: string, texts: readonly string[]): number | null {
  if (query) return foldedAny(foldName(query), texts)
  return texts.length ? 0 : null
}

function foldedAny(folded: string, texts: readonly string[]): number | null {
  let best: number | null = null
  for (const text of texts) {
    const score = foldedFuzzy(folded, text)
    if (score !== null && (best === null || score > best)) best = score
  }

  return best
}

export function rank<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string | readonly string[],
): T[] {
  const folded = foldName(query)
  const score = (said: string | readonly string[]) => {
    if (typeof said === 'string') return query ? foldedFuzzy(folded, said) : 0
    if (query) return foldedAny(folded, said)
    return said.length ? 0 : null
  }
  return items
    .map((item) => ({ item, score: score(label(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

export function recentFirst<T>(
  items: readonly T[],
  recent: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const place = new Map(recent.map((key, index) => [key, index]))
  const head: T[] = []
  const rest: T[] = []

  for (const item of items) (place.has(keyOf(item)) ? head : rest).push(item)

  const at = (item: T) => place.get(keyOf(item)) ?? 0
  return [...head.sort((one, other) => at(one) - at(other)), ...rest]
}
