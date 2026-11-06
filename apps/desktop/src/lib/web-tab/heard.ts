import type { hearHere } from '../own-window'
import { isRecord } from '../stored'
import { mute } from './mute'
import type { Page } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { answer, readAsk } from './passed.svelte'
import { asideFor, isMuted, keepZoom } from './sites'
import { settled, type Failure } from './upgrade'

export type Said = { tab: string } & (
  | { said: 'sound'; playing: boolean; muted: boolean }
  | { said: 'fill'; on: boolean }
  | { said: 'zoom'; factor: number }
  | {
      said: 'arrived'
      url: string
      failure: Failure | null
      bare: boolean
      reason: string | null
    }
  | { said: 'crashed' }
)

const FAILURES: readonly string[] = ['unreachable', 'certificate', 'other'] satisfies Failure[]

export interface NotArrived {
  url: string
  failure: Failure
  reason: string | null
}

export interface Found {
  tab: string
  count: number
  at: number
}

export function readSaid(value: unknown): Said | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const { tab, said } = value
  if (said === 'sound') {
    return { tab, said, playing: value.playing === true, muted: value.muted === true }
  }
  if (said === 'fill') return { tab, said, on: value.on === true }
  if (said === 'zoom' && typeof value.factor === 'number' && value.factor > 0) {
    return { tab, said, factor: value.factor }
  }
  if (said === 'arrived' && typeof value.url === 'string') {
    const failure = FAILURES.includes(value.failure as string) ? (value.failure as Failure) : null
    const reason = typeof value.reason === 'string' && value.reason ? value.reason : null
    return { tab, said, url: value.url, failure, bare: value.bare === true, reason }
  }
  if (said === 'crashed') return { tab, said }
  return null
}

export function readFound(value: unknown): Found | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const { tab, count, at } = value
  if (typeof count !== 'number' || typeof at !== 'number') return null
  return { tab, count: Math.max(0, count), at: count > 0 && at >= 0 ? at : -1 }
}

export function readUnplayable(value: unknown): string | null {
  return isRecord(value) && typeof value.tab === 'string' ? value.tab : null
}

export type Go = (tab: string, url: string) => void

export function heard(
  page: Page,
  said: Said,
  go?: Go,
  crashed?: (tab: string) => void,
  failed?: (tab: string, not: NotArrived) => void,
): void {
  switch (said.said) {
    case 'sound': {
      if (page.playing && !said.playing) page.heard = Date.now()
      page.playing = said.playing
      page.muted = said.muted
      const quiet = isMuted(siteOf(page.url), asideFor(said.tab, page))
      if (said.playing && said.muted !== quiet) mute(said.tab, page, quiet)
      return
    }
    case 'fill':
      page.filling = said.on
      return
    case 'zoom':
      page.zoom = said.factor
      keepZoom(siteOf(page.url), said.factor, asideFor(said.tab, page))
      return
    case 'crashed':
      crashed?.(said.tab)
      return
    case 'arrived': {
      const upgrade = page.upgrade
      const now = upgrade ? settled(upgrade, said.url, said.failure) : 'unrelated'
      if (upgrade && now !== 'unrelated') {
        page.upgrade = null
        if (now === 'fallback') {
          go?.(said.tab, upgrade.fallback)
          return
        }
      }
      if (said.failure && said.bare) {
        failed?.(said.tab, { url: said.url, failure: said.failure, reason: said.reason })
      }
      return
    }
  }
}

export function found(page: Page, said: Found): void {
  page.find.count = said.count
  page.find.at = said.at
}

export async function listening(
  listen: typeof hearHere,
  page: (tab: string) => Page | undefined,
  go: Go,
  crashed: (tab: string) => void,
  failed?: (tab: string, not: NotArrived) => void,
): Promise<void> {
  await listen('nib://web-page', (event) => {
    const said = readSaid(event.payload)
    const one = said && page(said.tab)
    if (one) heard(one, said, go, crashed, failed)
  })
  await listen('nib://web-found', (event) => {
    const said = readFound(event.payload)
    const one = said && page(said.tab)
    if (one) found(one, said)
  })
  await listen('nib://web-unplayable', (event) => {
    const tab = readUnplayable(event.payload)
    const one = tab === null ? undefined : page(tab)
    if (one) one.unplayable = true
  })
  await listen('nib://web-passed', (event) => {
    const ask = readAsk(event.payload)
    const one = ask && page(ask.tab)
    if (one) answer(ask.tab, one, ask.key)
  })
}
