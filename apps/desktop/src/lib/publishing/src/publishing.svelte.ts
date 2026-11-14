import {
  api,
  ApiError,
  type DnsRecord,
  type DomainStatus,
  type FormAnswer,
  type RemoteSpace,
  type SiteChanges,
  type SiteSettings,
  account,
} from '../../accounts/src/api'
import { invoke, sha256, log, relativeTo as relativeIn, afterQuiet } from '../../platform/src/api'
import { theme, carriedCss } from '../../theme/src/api'
import { isDomainStatus, keepAsking } from '../../domain-status'
import { message } from '../../ui-kit/src/api'
import { publishSheet } from '../../surfaces.svelte'
import { sync } from '../../sync.svelte'
import type { Space } from '../../workspace.svelte'

type Address = 'subdomain' | 'domain'

type Blog = RemoteSpace['blog']

interface Form {
  subdomain: string
  domain: string
  address: Address
  note: string
  rules: SiteSettings['rules']
  description: string
  password: string
  counter: string
  counterDomain: string
  themeName: string
  confirmed: boolean
}

const FIELDS = [
  'subdomain',
  'domain',
  'address',
  'note',
  'rules',
  'description',
  'password',
  'counter',
  'counterDomain',
  'themeName',
  'confirmed',
] as const satisfies readonly (keyof Form)[]

function formOf(blog: Blog | undefined): Form {
  const site = blog?.site
  return {
    subdomain: blog?.subdomain ?? '',
    domain: blog?.domain ?? '',
    address: blog?.domain ? 'domain' : 'subdomain',
    note: blog?.note ?? '',
    rules: copyRules(site?.rules),
    description: site?.description ?? '',
    password: '',
    counter: site?.analytics?.url ?? '',
    counterDomain: site?.analytics?.domain ?? '',
    themeName: site?.theme?.name ?? '',
    confirmed: !!blog?.enabled,
  }
}

function holdsPassword(blog: Blog | undefined): boolean {
  const site = blog?.site
  return !!site?.password
}

function copyRules(rules: SiteSettings['rules'] | undefined): SiteSettings['rules'] {
  return {
    include: [...(rules?.include ?? [])],
    exclude: [...(rules?.exclude ?? [])],
    otherwise: rules?.otherwise ?? 'all',
  }
}

const same = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other)

class Publish {
  open = $state(false)
  space = $state<Space | null>(null)
  spaceId = $state<string | null>(null)

  subdomain = $state('')
  domain = $state('')
  address = $state<Address>('subdomain')
  note = $state('')
  confirmed = $state(false)

  rules = $state<SiteSettings['rules']>({ include: [], exclude: [], otherwise: 'all' })
  description = $state('')
  password = $state('')
  hasPassword = $state(false)

  changes = $state<SiteChanges | null>(null)
  asking = $state(false)

  counter = $state('')
  counterDomain = $state('')

  themeName = $state('')

  answers = $state<FormAnswer[]>([])

  kept = $state<{ days: number; full: boolean } | null>(null)

  busy = $state(false)
  error = $state<string | null>(null)
  dns = $state<DnsRecord[]>([])
  status = $state<DomainStatus | null>(null)
  availability = $state<{
    checking: boolean
    available: boolean | null
    reason?: string | undefined
  }>({ checking: false, available: null })

  readonly remote = $derived.by(
    (): RemoteSpace | null => account.spaces.find((one) => one.id === this.spaceId) ?? null,
  )

  readonly blog = $derived.by((): Blog | undefined => this.remote?.blog)

  readonly published = $derived(!!this.blog?.enabled)

  private readonly checking = afterQuiet(() => void this.checkSubdomain(this.subdomain), 260)

  show(space: Space) {
    const id = sync.remoteIdFor(space.root)
    if (!id) return

    void publishSheet.ask()

    this.space = space
    this.spaceId = id
    this.error = null
    this.dns = []
    this.status = null
    this.availability = { checking: false, available: null }
    this.answers = []
    this.kept = null
    this.open = true
    this.refill(true)
  }

  close() {
    this.open = false
    this.stopWatchingDomain()
  }

  private filledFrom: string | null = null
  private filledWith: Form | null = null

  refill(fresh = false) {
    const blog = this.blog
    const from = JSON.stringify(blog ?? null)
    if (!fresh && from === this.filledFrom) return

    const next = formOf(blog)
    const was = fresh ? null : this.filledWith
    const now = this.form()
    const typed = was ? FIELDS.filter((key) => !same(now[key], was[key])) : []
    Object.assign(this, next, { rules: copyRules(next.rules) })
    for (const key of typed) Object.assign(this, { [key]: now[key] })
    this.hasPassword = holdsPassword(blog)

    this.filledFrom = from
    this.filledWith = next
  }

  private form(): Form {
    return Object.fromEntries(FIELDS.map((key) => [key, this[key]])) as unknown as Form
  }

  fill(blog: Blog | undefined) {
    Object.assign(this, { ...formOf(blog), confirmed: this.confirmed })
    this.hasPassword = holdsPassword(blog)
  }

  get themes(): { value: string; label: string }[] {
    return theme.files
      .filter((one) => !!one.path)
      .map((one) => ({ value: one.name, label: one.name }))
  }

  private async themeFor(
    token: string,
  ): Promise<{ name: string; hash: string } | null | undefined> {
    if (!this.themeName) return null

    const held = this.blog?.site.theme
    const kept = held?.name === this.themeName ? held : undefined

    const file = theme.files.find((one) => one.name === this.themeName && one.path)
    if (!file?.path) return kept

    const css = await invoke<string>('read_theme', { path: file.path })
      .then(carriedCss)
      .catch(() => '')
    if (!css) return kept

    const { pageSheet } = await import('../../theme-looks/src/api')
    const bytes = new TextEncoder().encode(pageSheet(css))
    const hash = await sha256(bytes)
    if (kept?.hash === hash) return kept

    await api.putBlob(token, hash, 'text/css', bytes.buffer)
    return { name: this.themeName, hash }
  }

  async readAnswers() {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token || !this.published) return

    try {
      const read = await api.answers(token, id)
      if (!this.holds(token, id)) return
      this.answers = read.answers
      this.kept = read.keptDays ? { days: read.keptDays, full: read.full === true } : null
    } catch {
      if (!this.holds(token, id)) return
      this.answers = []
      this.kept = null
    }
  }

  async forget(one: FormAnswer) {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return

    await api.forgetAnswer(token, id, one.id).catch(() => undefined)
    if (!this.holds(token, id)) return
    this.answers = this.answers.filter((held) => held.id !== one.id)
  }

  async answersCsv(): Promise<string | null> {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return null

    const csv = await api.answersCsv(token, id).catch(() => null)
    return this.holds(token, id) ? csv : null
  }

  rule(which: 'include' | 'exclude', folder: string, wanted: boolean) {
    const held = this.rules[which].filter((one) => one !== folder)
    if (wanted) held.push(folder)

    this.rules = { ...this.rules, [which]: held }
    this.ask()
  }

  otherwise(value: 'all' | 'none') {
    this.rules = { ...this.rules, otherwise: value }
    this.ask()
  }

  private previews = 0
  private readonly asked = afterQuiet(() => void this.askChanges(), 240)

  ask() {
    this.asked()
  }

  async askChanges() {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return

    const asking = ++this.previews
    this.asking = true

    try {
      const changes = await api.sitePreview(token, id, this.rules)
      if (asking !== this.previews || !this.holds(token, id)) return
      this.changes = changes
    } catch {
      if (asking !== this.previews) return
    } finally {
      if (asking === this.previews) this.asking = false
    }
  }

  relativeTo(path: string): string {
    return relativeIn(this.space?.root ?? '', path)
  }

  typeSubdomain(value: string) {
    this.subdomain = value.toLowerCase().replace(/[^a-z0-9-]/g, '')

    this.checking()
  }

  get ready(): boolean {
    return !this.busy && (this.address === 'subdomain' ? !!this.subdomain : !!this.domain)
  }

  private checks = 0

  async checkSubdomain(value: string) {
    const check = ++this.checks
    const token = account.accountToken

    if (!token || value.length < 2) {
      this.availability = { checking: false, available: null }
      return
    }

    this.availability = { checking: true, available: null }
    try {
      const result = await api.subdomainAvailable(token, value, this.spaceId ?? undefined)
      if (check !== this.checks || account.accountToken !== token) return
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

  async publish(icon: string | null = null) {
    const note = this.note || null
    this.error = null
    const token = account.accountToken
    if (!token) return

    if (!(await this.saveSite(token, icon))) return

    const sent = await this.send(
      token,
      this.address === 'subdomain'
        ? { subdomain: this.subdomain, note }
        : { domain: this.domain, note },
    )

    if (sent) await this.sendDiagrams(token)
  }

  private async sendDiagrams(token: string) {
    const id = this.spaceId
    const root = this.space?.root
    if (!id || !root || account.accountToken !== token) return

    const { pushDiagrams } = await import('../../site-diagrams')
    if (account.accountToken !== token) return
    const drawn = await pushDiagrams(token, id, root).catch(() => null)
    if (drawn && (drawn.sent || drawn.refused)) {
      log('info', `site diagrams: ${drawn.sent} drawn and sent, ${drawn.refused} refused`)
    }
  }

  private async saveSite(token: string, icon: string | null): Promise<boolean> {
    const id = this.spaceId
    if (!id || account.accountToken !== token) return false

    try {
      const chosen = await this.themeFor(token)
      if (!this.holds(token, id)) return false

      await api.site(token, id, {
        rules: this.rules,
        description: this.description.trim(),
        ...(icon ? { icon } : {}),
        ...(chosen === undefined ? {} : { theme: chosen }),
        analytics: this.counter.trim()
          ? {
              url: this.counter.trim(),
              ...(this.counterDomain.trim() ? { domain: this.counterDomain.trim() } : {}),
            }
          : null,
        ...(this.password ? { password: this.password } : {}),
      })
      if (!this.holds(token, id)) return false

      if (this.password) {
        this.hasPassword = true
        this.password = ''
      }
      return true
    } catch (error) {
      if (this.holds(token, id)) this.error = message(error, 'could not publish')
      return false
    }
  }

  async removePassword() {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return

    this.busy = true
    this.error = null

    try {
      await api.site(token, id, { password: null })
      if (!this.holds(token, id)) return
      this.hasPassword = false
      this.password = ''
      await account.loadSpaces()
    } catch (error) {
      if (this.holds(token, id)) this.error = message(error, 'that did not work')
    } finally {
      this.busy = false
    }
  }

  private async send(
    token: string,
    settings: {
      subdomain?: string
      domain?: string
      note?: string | null
    },
  ): Promise<boolean> {
    const id = this.spaceId
    if (!id || account.accountToken !== token) return false

    this.busy = true
    this.error = null

    try {
      const result = await api.publish(token, id, settings)
      if (!this.holds(token, id)) return false
      this.dns = result.dns
      await account.loadSpaces()
      this.refill(true)
      return true
    } catch (error) {
      if (this.holds(token, id)) this.error = message(error, 'could not publish')
      return false
    } finally {
      this.busy = false
    }
  }

  async unpublish() {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return

    this.busy = true
    this.error = null

    try {
      await api.unpublish(token, id)
      if (!this.holds(token, id)) return
      this.dns = []
      this.status = null
      await account.loadSpaces()
      this.refill(true)
    } catch (error) {
      if (this.holds(token, id)) this.error = message(error, 'could not reach the server')
    } finally {
      this.busy = false
    }
  }

  async verifyDomain() {
    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token) return

    this.busy = true
    this.error = null

    try {
      const status = await api.verifyDomain(token, id)
      if (!this.holds(token, id)) return
      this.status = status
      await account.loadSpaces()
    } catch (error) {
      if (!this.holds(token, id)) return
      const said = error instanceof ApiError ? error.body : null
      if (isDomainStatus(said)) this.status = said
      else this.error = message(error, 'that did not work')
    } finally {
      this.busy = false
    }

    if (keepAsking(this.status)) void this.watchDomain()
  }

  private askings = 0
  private domainTimer: ReturnType<typeof setTimeout> | undefined

  async watchDomain() {
    this.stopWatchingDomain()
    const asking = ++this.askings

    const id = this.spaceId
    const token = account.accountToken
    if (!id || !token || !this.blog?.domain) {
      this.status = null
      return
    }

    try {
      const status = await api.domainStatus(token, id)
      if (asking !== this.askings || !this.holds(token, id)) return
      this.status = status
    } catch {
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

  private holds(token: string, id: string): boolean {
    return account.accountToken === token && this.spaceId === id
  }

  forgetAccount() {
    this.close()
    this.askings++
    this.previews++
    this.checks++
    this.space = null
    this.spaceId = null
    this.changes = null
    this.asking = false
    this.answers = []
    this.kept = null
    this.busy = false
    this.error = null
    this.dns = []
    this.status = null
    this.availability = { checking: false, available: null }
    this.password = ''
    this.filledFrom = null
    this.filledWith = null
  }
}

export const publish = new Publish()

account.forgetWithSession(() => publish.forgetAccount())
