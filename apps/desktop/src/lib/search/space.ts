import { internal, invoke, isNative } from '../tauri'
import type { FuzzyHit } from '@orden/scan/search/fuzzy'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

const HITS = 'nib://search-hits'

export interface Found {
  hits: Hit[]
  loose: FuzzyHit[]
}

const PAPERS = 20

let asked = 0

export async function searchSpace(
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const { workspace } = await import('../workspace.svelte')
  const shut = workspace.protection.shutIn(root)
  if (shut === null) return
  if (shut.length) {
    excluded = [...excluded, ...shut]
    const told = onFound
    const open = (one: { path: string }) => !workspace.protection.locked(one.path)
    onFound = (found) => told({ hits: found.hits.filter(open), loose: found.loose.filter(open) })
  }
  const { papersFor, searchPapers } = await import('../pdf/papers')
  await papersFor(root)
  const papers = searchPapers(root, query, PAPERS, excluded)
  if (papers.length) onFound({ hits: papers, loose: [] })

  const inbox = await (await import('./inbox')).inboxHits(root, query, limit)
  if (inbox.length) onFound({ hits: inbox, loose: [] })

  if (!isNative) {
    const { searchInWorker } = await import('../web/search-client')
    let found = 0
    await searchInWorker(
      root,
      query,
      terms,
      limit,
      (batch) => {
        found += batch.hits.length
        onFound(batch)
      },
      excluded,
    )
    const { keptAway } = await import('../web/away.svelte')
    await keptAway.search(root, query, terms, limit - found, onFound, excluded)
    return
  }

  if (internal.routed) {
    const { searchInternal } = await import('../internal/search')
    if (await searchInternal(root, query, terms, limit, onFound, excluded)) return
  }

  const id = ++asked
  const { hearHere } = await import('../own-window')
  const stop = await hearHere<{ id: number; hits?: Hit[]; loose?: FuzzyHit[] }>(HITS, (event) => {
    const batch = event.payload
    if (batch.id !== id) return

    onFound({ hits: batch.hits ?? [], loose: batch.loose ?? [] })
  })

  try {
    await invoke('search_space', { root, query, terms, limit, id, excluded })
  } finally {
    stop()
  }
}
