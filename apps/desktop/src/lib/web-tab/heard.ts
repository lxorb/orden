/** What the engine says about a page beside where it is, landed on the tab's state.
 *
 *  Four things, each of them something a browser shows without being asked: the page is
 *  playing sound, or is muted; something in it holds the whole screen; it was zoomed
 *  inside the page; and how many matches a find found and which one is lit. And how a
 *  page arrived, which settles an address the bar gave `https:` to; see upgrade.ts - and
 *  when it did not, and the engine drew nothing for it, that it did not (#1093). And that
 *  its process has died, which leaves a white box unless somebody says so. The crate
 *  says them (see web_page.rs and web_find.rs); this reads them, because an event is a
 *  boundary like any other, and puts them where the tab strip, the bar and the find bar
 *  read them. And what the page asks: its find or its address field, when its own keys
 *  for them went by it; see passed.svelte.ts.
 *
 *  Two of them are also where a site's own memory is kept honest. A site somebody muted
 *  is muted in whichever tab it starts playing in, and a site that is not is heard again
 *  in a tab that was muted for the last one; and a zoom, however it was made, is the
 *  size that site opens at next time. See sites.ts. Fetched with the first page, like
 *  the rest of what the pages' listeners need. */

import type { listen as Listen } from '@tauri-apps/api/event'
import { isRecord } from '../stored'
import { mute } from './mute'
import type { Page } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { answer, readAsk } from './passed.svelte'
import { asideFor, isMuted, keepZoom } from './sites'
import { settled, type Failure } from './upgrade'

/** What the crate said about one tab's page. */
export type Said = { tab: string } & (
  | { said: 'sound'; playing: boolean; muted: boolean }
  | { said: 'fill'; on: boolean }
  | { said: 'zoom'; factor: number }
  | {
      said: 'arrived'
      url: string
      failure: Failure | null
      /** The engine drew nothing for the failure; see `Arrived` in web_page.rs. */
      bare: boolean
      /** Why, in the engine's words. */
      reason: string | null
    }
  | { said: 'crashed' }
)

const FAILURES: readonly string[] = ['unreachable', 'certificate', 'other'] satisfies Failure[]

/** A page that did not arrive and that the engine drew nothing for: where it was going,
 *  why, and the engine's own words for it. The pane says it instead; see `failed` in
 *  pages.svelte.ts. */
export interface NotArrived {
  url: string
  failure: Failure
  reason: string | null
}

/** How many matches a find has and which is lit, from nought, or -1 for none. */
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

/** The tab a video or a sound would not play in, for want of a decoder; see web_media.rs. */
export function readUnplayable(value: unknown): string | null {
  return isRecord(value) && typeof value.tab === 'string' ? value.tab : null
}

/** Where a page that did not arrive is sent instead: the tab and the address. */
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
      // When it fell quiet, which a page out of sight is not frozen for a while after;
      // see resting.ts.
      if (page.playing && !said.playing) page.heard = Date.now()
      page.playing = said.playing
      page.muted = said.muted
      // A page in a tab keeps whatever it was told last, and a tab carries on to other
      // sites: so the site it is on now decides, the moment there is sound to decide
      // about.
      const quiet = isMuted(siteOf(page.url), asideFor(said.tab, page))
      if (said.playing && said.muted !== quiet) mute(said.tab, page, quiet)
      return
    }
    case 'fill':
      page.filling = said.on
      return
    case 'zoom':
      page.zoom = said.factor
      // A private page's size is kept for its tab only, and written nowhere.
      keepZoom(siteOf(page.url), said.factor, asideFor(said.tab, page))
      return
    case 'crashed':
      crashed?.(said.tab)
      return
    case 'arrived': {
      // The https the bar chose for a host typed without a scheme, and nothing answered
      // there: plain http, as Chrome goes. See upgrade.ts.
      const upgrade = page.upgrade
      const now = upgrade ? settled(upgrade, said.url, said.failure) : 'unrelated'
      if (upgrade && now !== 'unrelated') {
        page.upgrade = null
        if (now === 'fallback') {
          go?.(said.tab, upgrade.fallback)
          return
        }
      }
      // A page that did not arrive and that nothing was drawn for: never an empty pane
      // under a spinner that does not stop, which is what a Mac showed for every site
      // that failed to load (#1093). The pane says so, and offers it again.
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

/** The events, heard for every page in the window: `page` is the tab's state, or
 *  nothing for a tab that has gone. Started with the first page; see `listen` in
 *  pages.svelte.ts. */
export async function listening(
  listen: typeof Listen,
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
  // The page's own keys for find and the address field that nothing in it took; see
  // passed.svelte.ts.
  await listen('nib://web-passed', (event) => {
    const ask = readAsk(event.payload)
    const one = ask && page(ask.tab)
    if (one) answer(ask.tab, one, ask.key)
  })
}
