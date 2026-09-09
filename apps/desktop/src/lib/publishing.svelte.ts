/** Putting a space on the web, from this side of the wire.
 *
 *  A blog belongs to a space rather than to an account: the server keeps it at
 *  `/v1/spaces/:id/blog`, one address per space, so publishing is asked about a
 *  space the way sharing is. Both are the same question about the same folder -
 *  who else may read this - which is why both are a sheet opened from the
 *  space's own menu; see PublishSheet.svelte and ShareSheet.svelte.
 *
 *  The form is filled from what the account already holds every time the sheet
 *  opens, so it never shows a half-typed address from last time. One or the
 *  other address, never both: a domain of one's own replaces the shared name, so
 *  the choice is the control rather than a pair of fields that could disagree. */

import { api, ApiError, type DnsRecord, type DomainStatus, type RemoteSpace } from './api'
import { account } from './account.svelte'
import { isDomainStatus, keepAsking } from './domain-status'
import { message } from './i18n.svelte'
import { ownsRemotely } from './sharing.svelte'
import { sync } from './sync.svelte'
import type { Space } from './workspace.svelte'

/** Which kind of address a blog is reached by. The sheet says which by name, so
 *  this is only ever read here. */
type Address = 'subdomain' | 'domain'

/** What the account holds about a space's blog. */
type Blog = RemoteSpace['blog']

class Publish {
  open = $state(false)
  /** The folder the sheet is about, and the space on the account behind it. */
  space = $state<Space | null>(null)
  spaceId = $state<string | null>(null)

  subdomain = $state('')
  domain = $state('')
  /** Which kind of address the blog is reached by. */
  address = $state<Address>('subdomain')
  /** Empty means the whole space; otherwise the one note's path in it. */
  note = $state('')
  /** Publishing is a public act, so it is asked about outright rather than
   *  assumed from the button being pressed. */
  confirmed = $state(false)

  busy = $state(false)
  error = $state<string | null>(null)
  /** What to add at the registrar, as the last publish answered. */
  dns = $state<DnsRecord[]>([])
  /** How far along a domain of one's own is, kept fresh while the sheet shows
   *  it. Null until asked, or when the space has no domain. */
  status = $state<DomainStatus | null>(null)
  availability = $state<{
    checking: boolean
    available: boolean | null
    /** Why not, when the server says. Undefined when it says nothing. */
    reason?: string | undefined
  }>({ checking: false, available: null })

  /** The space on the account this is about. Publishing needs it, and it only
   *  exists once syncing is on, since that is what creates the remote side. */
  readonly remote = $derived.by(
    (): RemoteSpace | null => account.spaces.find((one) => one.id === this.spaceId) ?? null,
  )

  /** What the account says the blog is, or undefined for a space that has none. */
  readonly blog = $derived.by((): Blog | undefined => this.remote?.blog)

  /** Whether the space is on the web right now. */
  readonly published = $derived(!!this.blog?.enabled)

  private checkTimer: ReturnType<typeof setTimeout> | undefined

  show(space: Space) {
    const id = sync.remoteIdFor(space.root)
    if (!id) return

    this.space = space
    this.spaceId = id
    this.error = null
    this.dns = []
    this.status = null
    this.availability = { checking: false, available: null }
    this.open = true
  }

  close() {
    this.open = false
    this.stopWatchingDomain()
  }

  /** Fills the form from what the account holds. */
  fill(blog: Blog | undefined) {
    this.subdomain = blog?.subdomain ?? ''
    this.domain = blog?.domain ?? ''
    this.address = blog?.domain ? 'domain' : 'subdomain'
    this.note = blog?.note ?? ''
  }

  /** The path the server knows a note by: relative to the space being
   *  published, forward slashed, whatever separator the machine writes. */
  relativeTo(path: string): string {
    const root = this.space?.root ?? ''
    return path
      .slice(root.length)
      .replace(/^[\\/]+/, '')
      .replace(/\\/g, '/')
  }

  /** Only the characters a subdomain may hold, and the availability check a
   *  moment after the typing stops rather than on every keystroke. */
  typeSubdomain(value: string) {
    this.subdomain = value.toLowerCase().replace(/[^a-z0-9-]/g, '')

    clearTimeout(this.checkTimer)
    this.checkTimer = setTimeout(() => void this.checkSubdomain(this.subdomain), 260)
  }

  get ready(): boolean {
    return !this.busy && (this.address === 'subdomain' ? !!this.subdomain : !!this.domain)
  }

  /** Which check is the latest. Typing outruns the network, and an older answer
   *  landing after a newer one would describe a name no longer in the box. */
  private checks = 0

  async checkSubdomain(value: string) {
    const check = ++this.checks

    if (!account.accountToken || value.length < 2) {
      this.availability = { checking: false, available: null }
      return
    }

    this.availability = { checking: true, available: null }
    try {
      const result = await api.subdomainAvailable(
        account.accountToken,
        value,
        this.spaceId ?? undefined,
      )
      if (check !== this.checks) return
      this.availability = {
        checking: false,
        available: result.available,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch {
      if (check !== this.checks) return
      this.availability = { checking: false, available: null }
    }
  }

  /** Only the chosen address goes up; the server lets the other one go. */
  async publish() {
    const note = this.note || null

    await this.send(
      this.address === 'subdomain'
        ? { subdomain: this.subdomain, note }
        : { domain: this.domain, note },
    )
  }

  private async send(settings: { subdomain?: string; domain?: string; note?: string | null }) {
    const id = this.spaceId
    if (!id || !account.accountToken) return

    this.busy = true
    this.error = null

    try {
      const result = await api.publish(account.accountToken, id, settings)
      this.dns = result.dns
      await account.loadSpaces()
    } catch (error) {
      this.error = message(error, 'could not publish')
    } finally {
      this.busy = false
    }
  }

  async unpublish() {
    const id = this.spaceId
    if (!id || !account.accountToken) return

    this.busy = true
    this.error = null

    try {
      await api.unpublish(account.accountToken, id)
      this.dns = []
      this.status = null
      await account.loadSpaces()
    } catch (error) {
      // Said out loud, the way publishing says it. Taking a space back off the
      // web is the half of the pair somebody is anxious about, and a button that
      // answers nothing at all reads as done.
      this.error = message(error, 'could not reach the server')
    } finally {
      this.busy = false
    }
  }

  /** The owner saying the record is in place. The server reads it there and
   *  then, so a domain either starts working under the button or the line under
   *  it says the record is not answering yet. */
  async verifyDomain() {
    const id = this.spaceId
    if (!id || !account.accountToken) return

    this.busy = true

    try {
      this.status = await api.verifyDomain(account.accountToken, id)
      await account.loadSpaces()
    } catch (error) {
      // The server answers with the state it is in, so a refusal is an answer
      // rather than a failure: it is shown where the state is shown.
      const said = error instanceof ApiError ? error.body : null
      if (isDomainStatus(said)) this.status = said
      else this.error = message(error, 'that did not work')
    } finally {
      this.busy = false
    }

    if (keepAsking(this.status)) void this.watchDomain()
  }

  /** Which asking is the latest, for the same reason as `checks`: the sheet can
   *  be closed and opened on another space while an answer is in flight. */
  private askings = 0
  private domainTimer: ReturnType<typeof setTimeout> | undefined

  /** Asks how far along the domain is, now and again every ten seconds for as
   *  long as the answer can still change. Cloudflare checks the record on its
   *  own schedule, so this is what turns "add this record" into "it works"
   *  without anyone reloading anything. */
  async watchDomain() {
    this.stopWatchingDomain()
    const asking = ++this.askings

    const id = this.spaceId
    if (!id || !account.accountToken || !this.blog?.domain) {
      this.status = null
      return
    }

    try {
      const status = await api.domainStatus(account.accountToken, id)
      if (asking !== this.askings) return
      this.status = status
    } catch {
      // Left as it was: a request that failed says nothing about the domain.
      if (asking !== this.askings) return
    }

    if (keepAsking(this.status)) {
      this.domainTimer = setTimeout(() => void this.watchDomain(), 10_000)
    }
  }

  stopWatchingDomain() {
    clearTimeout(this.domainTimer)
    this.domainTimer = undefined
  }
}

export const publish = new Publish()

/** Whether a space can be published from here: it is on the account, and it is
 *  this account's to publish. The same question sharing asks, because it is the
 *  same folder on the same server. */
export function canPublish(space: Space): boolean {
  return ownsRemotely(space)
}
