import { invoke } from '../../platform/src/api'
import { placesForgotten } from './place'
import { siteIcons } from './site-icons.svelte'
import { visited } from './visited'
import { ownStore, webData } from './web-data.svelte'

const RANGES = {
  quarter: 15 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 28 * 24 * 60 * 60_000,
  all: null,
} as const

export type Range = keyof typeof RANGES

export const DEFAULT_RANGE: Range = 'hour'

export interface Asked {
  range: Range
  history: boolean
  site: boolean
  cache: boolean
}

export function sinceFor(range: Range, now: number): number {
  const back = RANGES[range]
  return back === null ? 0 : now - back
}

function originOf(url: string): string | null {
  try {
    const at = new URL(url)
    return at.protocol === 'https:' || at.protocol === 'http:' ? at.origin : null
  } catch {
    return null
  }
}

export function sitesSince(books: readonly string[], since: number): string[] {
  const sites = new Set<string>()
  for (const book of books) {
    for (const visit of visited.all(book)) {
      const origin = visit.last >= since ? originOf(visit.url) : null
      if (origin) sites.add(origin)
    }
  }
  return [...sites]
}

export function reach(apart: readonly (string | null)[]): {
  stores: (string | null)[]
  books: string[]
} {
  const own = apart.map((one) => ownStore(one)).filter((one) => one !== null)
  return { stores: [null, ...new Set(own)], books: [webData.history()] }
}

export async function clearData(
  asked: Asked,
  apart: readonly (string | null)[],
  now = Date.now(),
): Promise<void> {
  const since = sinceFor(asked.range, now)
  const { stores, books } = reach(apart)

  if (asked.site || asked.cache) {
    await invoke('web_clear', {
      stores,
      clearing: { since, site: asked.site, cache: asked.cache },
      sites: sitesSince(books, since),
    })
  }

  if (asked.history) {
    const gone = new Set(books.flatMap((book) => visited.removeSince(book, since)))
    placesForgotten(since <= 0 ? null : gone)
    await siteIcons.forgetSince(since)
  }
}
