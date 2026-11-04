/** The marks of the sites the account has been to, as this device holds them: the icon
 *  picker's Web icons (#1054), most recently seen first.
 *
 *  The list is the account's, kept by the sync service (services/sync/src/site-icons.ts),
 *  so a site opened on another device is here without being opened on this one. The
 *  pictures come from the service too, which fetched each one from where its page said
 *  it was: nothing here asks a site for anything. What arrived is kept on this device,
 *  so the picker and every icon chosen from it draw offline.
 *
 *  Told of a site by a web tab that is not private, once per site and mark in a run;
 *  told to forget by "Delete browsing data"; and silent for a device nobody is signed
 *  in on with an account, which has no list to add to. Not in front of the first paint:
 *  the picker's set (icon-sets.ts), the tab that saw a mark and the clearing each fetch
 *  this when they first need it. */

import { account } from '../account.svelte'
import { api } from '../api'
import type { LoadedSet } from '../icon-sets'
import { isNumber, isRecord, isString, keepJson, stored } from '../stored'

/** Where this device keeps what arrived. */
const KEY = 'nib:site-icons'

/** How many sites are kept, as the service keeps them. */
const MOST_SITES = 300

/** And how much picture: a favicon is a few kilobytes, and storage is shared with
 *  everything else this device remembers. The newest keep theirs. */
const MOST_TEXT = 1024 * 1024

/** How often the list is asked for again while the picker is in use. */
const AGAIN_MS = 30_000

/** How long nothing is asked of the service after it could not be reached or did not
 *  know the call: a page reports its mark again and again, and a service from before
 *  the Web icons (the Worker is deployed from main, the app from wherever) would be
 *  asked every time. */
const QUIET_MS = 10 * 60_000

/** Whether a failed call was the service saying it has no such thing, which is a
 *  service from before the Web icons rather than a moment offline. */
function unknownTo(error: unknown): boolean {
  return isRecord(error) && error.status === 404
}

/** One site as this device holds it. */
export interface HeldSite {
  site: string
  label: string
  seen: number
  /** The hash of the picture the service holds, and the picture as a `data:` address,
   *  or null for a site whose mark did not come. */
  hash: string | null
  picture: string | null
}

function readSite(value: unknown): HeldSite | null {
  if (!isRecord(value) || !isString(value.site) || !isNumber(value.seen)) return null
  return {
    site: value.site,
    label: isString(value.label) ? value.label : '',
    seen: value.seen,
    hash: isString(value.hash) ? value.hash : null,
    picture:
      isString(value.picture) && value.picture.startsWith('data:image/') ? value.picture : null,
  }
}

function readList(value: unknown): HeldSite[] {
  return Array.isArray(value) ? value.flatMap((one) => readSite(one) ?? []) : []
}

/** The site an address is on, as the service writes it: the host, lower case, without
 *  `www.`; null for anything that is not a page on the web. */
export function siteOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':') ? host : null
  } catch {
    return null
  }
}

/** What a site is called, from a page of it: the title of its front page, which is the
 *  site's own name - a page further in is titled for what is on it, and says nothing
 *  of the site. Empty for those, and the service keeps the name it had. */
export function labelOf(url: string | null | undefined, title: string): string {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away
    return new URL(url ?? '').pathname === '/' ? title.trim().slice(0, 120) : ''
  } catch {
    return ''
  }
}

/** The list as it is written down: newest first, within the ceilings, the oldest
 *  giving up their pictures first. */
export function bounded(list: readonly HeldSite[]): HeldSite[] {
  const sorted = [...list].sort((one, other) => other.seen - one.seen).slice(0, MOST_SITES)
  let text = 0
  return sorted.map((one) => {
    text += one.picture?.length ?? 0
    return text > MOST_TEXT ? { ...one, picture: null } : one
  })
}

class SiteIcons {
  /** Every site, newest first. */
  list = $state<HeldSite[]>(readList(stored(KEY)))

  /** What each tab last told the service, so a page showing its mark a hundred times
   *  is one call. */
  private told = new Map<string, string>()
  private asked = 0
  private asking: Promise<void> | null = null
  /** Until when nothing is asked of the service; see `QUIET_MS`. */
  private quietUntil = 0

  /** Whether the service does not keep Web icons at all, as far as it last said: the
   *  picker then leaves the section out rather than promising sites that never come. */
  lacking = $state(false)

  /** A call failed: quiet for a while, and lacking where the service said so. */
  private failed(error: unknown) {
    this.quietUntil = Date.now() + QUIET_MS
    if (unknownTo(error)) this.lacking = true
  }

  private quiet(): boolean {
    return Date.now() < this.quietUntil
  }

  /** The picture of a site, or null where this device holds none. */
  picture(site: string): string | null {
    return this.list.find((one) => one.site === site)?.picture ?? null
  }

  /** The list again from the service, and the pictures that changed. At most every
   *  `AGAIN_MS`, and never two at once. */
  refresh(): Promise<void> {
    const token = account.accountToken
    if (!token || this.asking || this.quiet() || Date.now() - this.asked < AGAIN_MS) {
      return this.asking ?? Promise.resolve()
    }

    this.asked = Date.now()
    this.asking = this.fetch(token).finally(() => (this.asking = null))
    return this.asking
  }

  private async fetch(token: string) {
    let sites
    try {
      sites = (await api.siteIcons(token)).sites
    } catch (error) {
      // Offline, or a service from before this: what is held stays, and draws, and
      // nobody is told.
      this.failed(error)
      return
    }
    this.lacking = false

    const held = new Map(this.list.map((one) => [one.site, one]))
    const next: HeldSite[] = []
    for (const one of sites) {
      const was = held.get(one.site)
      const picture =
        was?.hash === one.hash && (was.picture !== null || one.hash === null)
          ? was.picture
          : one.hash === null
            ? null
            : await api.siteIconPicture(token, one.site).catch(() => was?.picture ?? null)
      next.push({ site: one.site, label: one.label, seen: one.seen, hash: one.hash, picture })
    }

    this.write(next)
  }

  /** A tab that is not private is on `url`, titled `title`, and its page shows `icon`
   *  as its mark. */
  async saw(url: string | null | undefined, title: string, icon: string | null) {
    const site = siteOf(url)
    const token = account.accountToken
    if (!site || !token || this.quiet()) return
    const label = labelOf(url, title)

    const said = icon ?? ''
    if (this.told.get(site) === said) return
    this.told.set(site, said)

    try {
      const { site: row } = await api.sawSite(token, { site, label, icon, seen: Date.now() })
      if (!row) return

      const was = this.list.find((one) => one.site === row.site)
      const picture =
        was?.hash === row.hash && was.picture
          ? was.picture
          : row.hash === null
            ? null
            : await api.siteIconPicture(token, row.site).catch(() => null)
      this.write([
        { site: row.site, label: row.label, seen: row.seen, hash: row.hash, picture },
        ...this.list.filter((one) => one.site !== row.site),
      ])
    } catch (error) {
      // Told again the next time the page shows its mark once the quiet is over, and
      // nobody is told it failed: the page itself is fine.
      this.told.delete(site)
      this.failed(error)
    }
  }

  /** Forgets the sites seen since `since` - every one, for zero - here and on the
   *  account, which is what "Delete browsing data" asks of the history. */
  async forgetSince(since: number) {
    this.write(this.list.filter((one) => one.seen < since))
    this.told.clear()
    const token = account.accountToken
    if (token) await api.forgetSites(token, { since }).catch(() => undefined)
  }

  private write(list: readonly HeldSite[]) {
    this.list = bounded(list)
    keepJson(KEY, this.list)
  }
}

export const siteIcons = new SiteIcons()

/** What a site is called in the picker: its own name where a page gave one, else its
 *  address. */
export function siteLabel(one: HeldSite): string {
  return one.label || one.site
}

/** The account's sites as a set of icons, for the picker and for every row wearing one
 *  (`site:github.com`; see `SITE_ICONS` in icons.ts). Read off the list each time it is
 *  asked, so a site seen while the picker is up, or arriving from another device, is in
 *  it at once. A class rather than an object: the library holds its sets in state, and a
 *  plain object there would be copied into a proxy that reads the list once. A site whose
 *  picture has not arrived on this device draws nothing, and its row its own mark. */
class SiteSet implements LoadedSet {
  groups = []

  get unoffered() {
    return siteIcons.lacking
  }

  get entries() {
    return siteIcons.list
      .filter((one) => one.picture !== null)
      .map((one) => ({
        name: one.site,
        words: siteLabel(one).toLowerCase(),
        terms: `${one.site} ${one.site.replace(/\./g, ' ')}`,
      }))
  }

  shape(name: string) {
    const src = siteIcons.picture(name)
    return src ? { kind: 'picture' as const, src } : null
  }
}

/** The set, and the list asked for again from the service, whenever the set is. */
export function siteSet(): LoadedSet {
  void siteIcons.refresh()
  return new SiteSet()
}
