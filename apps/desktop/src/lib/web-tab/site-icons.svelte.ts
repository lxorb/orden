import { account, api } from '../accounts/src/api'
import type { LoadedSet } from '../icon-sets'
import { isNumber, isRecord, isString, keepJson, stored } from '../platform/src/api'

const KEY = 'orden:site-icons'

const MOST_SITES = 300

const MOST_TEXT = 1024 * 1024

const AGAIN_MS = 30_000

const QUIET_MS = 10 * 60_000

function unknownTo(error: unknown): boolean {
  return isRecord(error) && error.status === 404
}

export interface HeldSite {
  site: string
  label: string
  seen: number
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

export function labelOf(url: string | null | undefined, title: string): string {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away
    return new URL(url ?? '').pathname === '/' ? title.trim().slice(0, 120) : ''
  } catch {
    return ''
  }
}

export function bounded(list: readonly HeldSite[]): HeldSite[] {
  const sorted = [...list].sort((one, other) => other.seen - one.seen).slice(0, MOST_SITES)
  let text = 0
  return sorted.map((one) => {
    text += one.picture?.length ?? 0
    return text > MOST_TEXT ? { ...one, picture: null } : one
  })
}

async function draws(picture: string): Promise<boolean> {
  if (typeof Image !== 'function') return true
  const image = new Image()
  if (typeof image.decode !== 'function') return true
  image.src = picture
  try {
    await image.decode()
    return image.naturalWidth > 0
  } catch {
    return false
  }
}

class SiteIcons {
  list = $state<HeldSite[]>(readList(stored(KEY)))

  constructor() {
    void this.dropBroken()
  }

  private async dropBroken() {
    const broken: string[] = []
    for (const one of this.list) {
      if (one.picture !== null && !(await draws(one.picture))) broken.push(one.site)
    }
    if (!broken.length) return
    this.write(
      this.list.map((one) =>
        broken.includes(one.site) ? { ...one, hash: null, picture: null } : one,
      ),
    )
  }

  private told = new Map<string, string>()
  private asked = 0
  private asking: Promise<void> | null = null
  private quietUntil = 0

  lacking = $state(false)

  private failed(error: unknown) {
    this.quietUntil = Date.now() + QUIET_MS
    if (unknownTo(error)) this.lacking = true
  }

  private quiet(): boolean {
    return Date.now() < this.quietUntil
  }

  picture(site: string): string | null {
    return this.list.find((one) => one.site === site)?.picture ?? null
  }

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
      if (account.accountToken === token) this.failed(error)
      return
    }
    if (account.accountToken !== token) return
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
    if (account.accountToken !== token) return

    this.write(next)
    await this.dropBroken()
  }

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
      if (!row || account.accountToken !== token) return

      const was = this.list.find((one) => one.site === row.site)
      const picture =
        was?.hash === row.hash && was.picture
          ? was.picture
          : row.hash === null
            ? null
            : await api.siteIconPicture(token, row.site).catch(() => null)
      if (account.accountToken !== token) return
      this.write([
        { site: row.site, label: row.label, seen: row.seen, hash: row.hash, picture },
        ...this.list.filter((one) => one.site !== row.site),
      ])
    } catch (error) {
      if (account.accountToken !== token) return
      this.told.delete(site)
      this.failed(error)
    }
  }

  forgetAccount() {
    this.write([])
    this.told.clear()
    this.asked = 0
    this.asking = null
    this.quietUntil = 0
    this.lacking = false
  }

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

account.forgetWithSession(() => siteIcons.forgetAccount())

export function siteLabel(one: HeldSite): string {
  return one.label || one.site
}

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

export function siteSet(): LoadedSet {
  void siteIcons.refresh()
  return new SiteSet()
}
