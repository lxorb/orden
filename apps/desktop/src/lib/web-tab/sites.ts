/** What this device remembers about a site beside what it may do: whether it is muted,
 *  and how large it is drawn.
 *
 *  Chrome keeps both by site. "Mute site" in a tab's menu silences that site in every
 *  tab and the next time it is opened, until it is unmuted; a page zoomed with Ctrl and
 *  the wheel opens at that size again, and every other site at a hundred per cent. A
 *  zoom kept for one tab only was the bug: a new site in the same tab was drawn at the
 *  last site's size, and the site the reader had made larger was small again tomorrow.
 *
 *  By site as the bar shows it (`siteOf`), and this device's, like the permissions
 *  beside it: it is about this screen and these speakers. Nothing is kept for a site at
 *  its defaults, so the store holds only what somebody chose. */

import { withOrWithout } from '../records'
import { isNumber, recordOf, Shared, stringList } from '../stored'

/** The sites muted, and how large each site is drawn where it is not a hundred per
 *  cent: read again whenever another window wrote them, so one window's choice is not
 *  written over by what the other read at first. See `Shared` in stored.ts. */
const muted = new Shared('nib:web-muted', (value) => new Set(stringList(value) ?? []))
const zooms = new Shared('nib:web-zooms', (value) => recordOf(value, isNumber))

/** What a private tab was told, by tab: kept in memory and never written, the way
 *  nothing else about a private tab is (see private.ts), and gone with the tab. A
 *  private tab reads what this device keeps, and keeps what it changes to itself.
 *  `aside` below is a private tab's id, and is left out for every other tab. */
const asides = new Map<string, { muted: Map<string, boolean>; zooms: Map<string, number> }>()

function asideOf(tab: string) {
  let one = asides.get(tab)
  if (!one) {
    one = { muted: new Map(), zooms: new Map() }
    asides.set(tab, one)
  }
  return one
}

/** The tab a page keeps its choices to: its own where it is private, else none. */
export function asideFor(tab: string, page: { inPrivate: boolean }): string | undefined {
  return page.inPrivate ? tab : undefined
}

/** Whether a site is muted. Nothing is, before anybody said so. */
export function isMuted(site: string, aside?: string): boolean {
  if (site === '') return false
  return asides.get(aside ?? '')?.muted.get(site) ?? muted.get().has(site)
}

/** Mutes a site, or lets it be heard again. */
export function setMuted(site: string, on: boolean, aside?: string): void {
  if (!site) return
  if (aside !== undefined) {
    asideOf(aside).muted.set(site, on)
    return
  }

  const all = new Set(muted.get())
  if (on) all.add(site)
  else all.delete(site)
  muted.set(all, JSON.stringify([...all]))
}

/** How large a site is drawn: what it was left at, or a hundred per cent. */
export function zoomOf(site: string, aside?: string): number {
  return asides.get(aside ?? '')?.zooms.get(site) ?? zooms.get()[site] ?? 1
}

/** Remembers how large a site is drawn. A hundred per cent is forgetting it. */
export function keepZoom(site: string, factor: number, aside?: string): void {
  if (!site || !Number.isFinite(factor) || factor <= 0) return

  // The engine answers in doubles, and 1.1 comes back as 1.1000000238. Two places
  // is every rung of the ladder, and makes one answer of the two.
  const round = Math.round(factor * 100) / 100
  if (aside !== undefined) {
    asideOf(aside).zooms.set(site, round)
    return
  }

  const all = withOrWithout(zooms.get(), site, round === 1 ? null : round)
  zooms.set(all, JSON.stringify(all))
}

/** A private tab has closed: what it was told goes with it. */
export function forgetAside(tab: string): void {
  asides.delete(tab)
}

/** Forgets what was read, for a test that writes storage underneath. */
export function reread(): void {
  muted.drop()
  zooms.drop()
  asides.clear()
}
