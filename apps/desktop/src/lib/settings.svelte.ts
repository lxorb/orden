import { setSnippets } from '@nib/editor'
import { api, type DnsRecord, type DomainStatus, type RemoteSpace } from './api'
import { account } from './account.svelte'
import { connectors } from './connectors.svelte'
import { keepAsking } from './domain-status'
import { message } from './i18n.svelte'
import { DEFAULT_PAGE_SETUP, type PageSetup } from './page-setup'
import { invoke, isDesktop } from './tauri'
import { sync } from './sync.svelte'
import { workspace } from './workspace.svelte'

const PAGE_KEY = 'nib:page'
const APPEARANCE_KEY = 'nib:export-appearance'

/** How an exported page is coloured: light, dark, or as the app looks now. */
export type ExportAppearance = 'light' | 'dark' | 'app'

export type Section =
  | 'general'
  | 'editor'
  | 'spelling'
  | 'markdown'
  | 'appearance'
  | 'account'
  | 'publish'
  | 'llm'
  | 'trash'
  | 'export'

class Settings {
  open = $state(false)
  section = $state<Section>('general')
  /** On a phone the panes are a list first and a page second: this is whether
   *  the list is showing rather than one of them. A desktop shows both. */
  listing = $state(true)
  /** The version-history sheet, which is its own overlay. */
  historyOpen = $state(false)

  /** Whether pandoc is on this machine, which decides the export list. */
  pandoc = $state(false)

  /** Paper and running text for export. A note's front matter overrules it. */
  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  /** Light by default: a document is read on paper, or sent to someone whose
   *  screen is not this one. */
  exportAppearance = $state<ExportAppearance>('light')

  /** Whether Explorer's "New" menu offers a markdown document. Windows only. */
  newMenu = $state(false)

  busy = $state(false)
  error = $state<string | null>(null)
  dns = $state<DnsRecord[]>([])
  /** How far along a domain of one's own is, kept fresh while the pane
   *  shows it. Null until asked, or when the space has no domain. */
  domain = $state<DomainStatus | null>(null)
  availability = $state<{ checking: boolean; available: boolean | null; reason?: string }>({
    checking: false,
    available: null,
  })

  /** The remote space the open one mirrors to. Publishing needs it, and it only
   *  exists once syncing is on, since that is what creates the remote side. */
  readonly remote = $derived.by((): RemoteSpace | null => {
    const root = workspace.activeSpace?.root
    if (!root) return null

    const id = sync.remoteIdFor(root)
    return account.spaces.find((space) => space.id === id) ?? null
  })

  restore() {
    connectors.restore()

    try {
      const saved = JSON.parse(localStorage.getItem(PAGE_KEY) ?? '{}')
      this.page = { ...DEFAULT_PAGE_SETUP, ...saved }
    } catch {
      // Defaults are the safe ones.
    }

    const appearance = localStorage.getItem(APPEARANCE_KEY)
    if (appearance === 'light' || appearance === 'dark' || appearance === 'app') {
      this.exportAppearance = appearance
    }

    void import('./export').then(({ pandocAvailable }) =>
      pandocAvailable().then((found) => (this.pandoc = found)),
    )

    void this.loadSnippets()

    if (isDesktop) {
      void invoke<boolean>('new_menu_registered')
        .then((on) => (this.newMenu = on))
        .catch(() => undefined)
    }
  }

  /** Adds or removes Explorer's "New ▸ Markdown Document" entry. */
  async setNewMenu(enabled: boolean) {
    if (!isDesktop) return

    this.error = null
    try {
      await invoke('set_new_menu', { enabled })
      this.newMenu = enabled
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  setPage(patch: Partial<PageSetup>) {
    this.page = { ...this.page, ...patch }
    localStorage.setItem(PAGE_KEY, JSON.stringify(this.page))
  }

  setExportAppearance(appearance: ExportAppearance) {
    this.exportAppearance = appearance
    localStorage.setItem(APPEARANCE_KEY, appearance)
  }

  /** Reads `snippets.json` into the editor's completion source. */
  async loadSnippets() {
    if (!isDesktop) return

    const raw = await invoke<string>('read_snippets').catch(() => '{}')
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const usable = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>

      setSnippets(usable)
    } catch {
      // A malformed file simply means no snippets, not a broken editor.
      setSnippets({})
    }
  }

  /** Opens on General, or on the list of panes where the screen is a phone's.
   *  Asked for by name, a pane opens straight away on both. */
  show(section?: Section) {
    this.section = section ?? 'general'
    this.listing = section === undefined
    this.open = true
    this.error = null
    connectors.freshToken = null
  }

  /** Which check is the latest. Typing outruns the network, and an older
   *  answer landing after a newer one would describe a name no longer in the
   *  box. */
  private checks = 0

  async checkSubdomain(value: string) {
    const check = ++this.checks

    if (!account.token || value.length < 2) {
      this.availability = { checking: false, available: null }
      return
    }

    this.availability = { checking: true, available: null }
    try {
      const result = await api.subdomainAvailable(account.token, value, this.remote?.id)
      if (check !== this.checks) return
      this.availability = { checking: false, available: result.available, reason: result.reason }
    } catch {
      if (check !== this.checks) return
      this.availability = { checking: false, available: null }
    }
  }

  async publish(settings: {
    subdomain?: string
    domain?: string
    title?: string
    note?: string | null
  }) {
    const space = this.remote
    if (!space || !account.token) return

    this.busy = true
    this.error = null

    try {
      const result = await api.publish(account.token, space.id, settings)
      this.dns = result.dns
      await account.loadSpaces()
    } catch (error) {
      this.error = message(error, 'could not publish')
    } finally {
      this.busy = false
    }
  }

  async unpublish() {
    const space = this.remote
    if (!space || !account.token) return

    this.busy = true
    try {
      await api.unpublish(account.token, space.id)
      this.dns = []
      this.domain = null
      await account.loadSpaces()
    } finally {
      this.busy = false
    }
  }

  /** Which asking is the latest, for the same reason as `checks`: the pane
   *  can move to another space while an answer is in flight. */
  private askings = 0
  private domainTimer: ReturnType<typeof setTimeout> | undefined

  /** Asks how far along the domain is, now and again every ten seconds for
   *  as long as the answer can still change. Cloudflare checks the record on
   *  its own schedule, so this is what turns "add this record" into "it
   *  works" without anyone reloading anything. */
  async watchDomain() {
    this.stopWatchingDomain()
    const asking = ++this.askings

    const space = this.remote
    if (!space || !account.token || !space.blog.domain) {
      this.domain = null
      return
    }

    try {
      const status = await api.domainStatus(account.token, space.id)
      if (asking !== this.askings) return
      this.domain = status
    } catch {
      // Left as it was: a request that failed says nothing about the domain.
      if (asking !== this.askings) return
    }

    if (keepAsking(this.domain)) {
      this.domainTimer = setTimeout(() => void this.watchDomain(), 10_000)
    }
  }

  stopWatchingDomain() {
    clearTimeout(this.domainTimer)
    this.domainTimer = undefined
  }
}

export const settings = new Settings()
