import {
  forget,
  isRecord,
  keep,
  stored,
  storedText,
  invoke,
  isDesktop,
} from '../../platform/src/api'
import { hostOf } from '@orden/scan/visits'
import { isWebData, siteOf, storeName, type WebData } from './web-data'
import { HISTORY } from './web-data.svelte'
import { bounded } from './visits'
import type { Visit } from '@orden/scan/visits'

const OLD = 'orden:web-data'
const OLD_UP = 'orden:web-data-up'

export const MERGED = 'orden:web-data-merged'

interface Merge {
  from: string
  origins: string[]
}

export function oldChoices(saved: unknown): Record<string, Exclude<WebData, 'global'>> {
  if (!isRecord(saved)) return {}
  const out: Record<string, Exclude<WebData, 'global'>> = {}
  for (const [space, choice] of Object.entries(saved)) {
    if (isWebData(choice) && choice !== 'global') out[space] = choice
  }
  return out
}

export function oldHistory(space: string): string {
  return `${HISTORY}:${space}`
}

function originOf(url: string): string | null {
  try {
    const at = new URL(url)
    return at.protocol === 'https:' || at.protocol === 'http:' ? at.origin : null
  } catch {
    return null
  }
}

export function planned(
  choices: Record<string, Exclude<WebData, 'global'>>,
  historyOf: (space: string) => readonly Visit[],
  registrable: (host: string) => string | null,
): Merge[] {
  const out: Merge[] = []
  for (const [space, choice] of Object.entries(choices)) {
    const origins = [
      ...new Set(
        historyOf(space)
          .map((one) => originOf(one.url))
          .filter((one) => one !== null),
      ),
    ]
    if (choice === 'space') {
      const from = storeName('space', space, null)
      if (from) out.push({ from, origins })
      continue
    }
    const bySite = new Map<string, string[]>()
    for (const origin of origins) {
      const host = hostOf(origin)
      if (!host) continue
      const site = siteOf(host, registrable)
      const gathered = bySite.get(site)
      if (gathered) gathered.push(origin)
      else bySite.set(site, [origin])
    }
    for (const [site, theirs] of bySite) {
      const from = storeName('site', space, site)
      if (from) out.push({ from, origins: theirs })
    }
  }
  return out
}

export function folded(into: readonly Visit[], from: readonly Visit[]): readonly Visit[] {
  const rows = new Map(into.map((one) => [one.url, one]))
  for (const one of from) {
    const was = rows.get(one.url)
    rows.set(
      one.url,
      was
        ? {
            url: one.url,
            title: (one.last > was.last ? one.title : was.title) || one.title || was.title,
            visits: was.visits + one.visits,
            typed: was.typed + one.typed,
            last: Math.max(was.last, one.last),
          }
        : one,
    )
  }
  return bounded([...rows.values()])
}

export async function mergeOld(): Promise<void> {
  if (!isDesktop || storedText(MERGED) !== null) return

  const choices = oldChoices(stored(OLD))
  const spaces = Object.keys(choices)
  if (spaces.length === 0) {
    keep(MERGED, new Date().toISOString())
    return
  }

  const [{ visited }, { getDomain }] = await Promise.all([import('./visited'), import('tldts')])
  const plan = planned(
    choices,
    (space) => visited.all(oldHistory(space)),
    (host) => getDomain(host, { allowPrivateDomains: true }),
  )

  let whole = true
  for (const one of plan) {
    try {
      await invoke('web_merge', { from: one.from, origins: one.origins })
    } catch (error) {
      whole = false
      console.warn(`orden: ${one.from} could not be merged into the shared web data`, error)
    }
  }
  if (!whole) return

  for (const space of spaces) {
    const from = oldHistory(space)
    visited.fold(from, HISTORY, folded(visited.all(HISTORY), visited.all(from)))
  }
  forget(OLD)
  forget(OLD_UP)
  keep(MERGED, new Date().toISOString())
}
