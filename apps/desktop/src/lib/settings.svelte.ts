import { setSnippets } from '@nib/editor'
import { api, type DnsRecord, type RemoteSpace } from './api'
import { account } from './account.svelte'
import { message } from './i18n.svelte'
import { DEFAULT_PAGE_SETUP, type PageSetup } from './page-setup'
import { invoke, isDesktop } from './tauri'
import { sync } from './sync.svelte'
import { workspace } from './workspace.svelte'

const STORAGE_KEY = 'nib:llm'
const PAGE_KEY = 'nib:page'

export type Section =
  | 'general'
  | 'editor'
  | 'markdown'
  | 'appearance'
  | 'account'
  | 'publish'
  | 'llm'
  | 'export'

interface Connector {
  exists: boolean
  readOnly: boolean
  lastUsedAt: number | null
}

class Settings {
  open = $state(false)
  section = $state<Section>('general')
  /** On a phone the panes are a list first and a page second: this is whether
   *  the list is showing rather than one of them. A desktop shows both. */
  listing = $state(true)
  /** The version-history sheet, which is its own overlay. */
  historyOpen = $state(false)

  /** LLM access is read-only until widened. */
  llmReadOnly = $state(true)
  connector = $state<Connector | null>(null)
  /** Shown once, straight after minting. It is never retrievable again. */
  freshToken = $state<string | null>(null)

  /** Whether pandoc is on this machine, which decides the export list. */
  pandoc = $state(false)

  /** Paper and running text for export. A note's front matter overrules it. */
  page = $state<PageSetup>({ ...DEFAULT_PAGE_SETUP })

  /** Whether Explorer's "New" menu offers a markdown document. Windows only. */
  newMenu = $state(false)

  busy = $state(false)
  error = $state<string | null>(null)
  dns = $state<DnsRecord[]>([])
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
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      this.llmReadOnly = saved.readOnly ?? true
    } catch {
      // Defaults are the safe ones.
    }

    try {
      const saved = JSON.parse(localStorage.getItem(PAGE_KEY) ?? '{}')
      this.page = { ...DEFAULT_PAGE_SETUP, ...saved }
    } catch {
      // Defaults are the safe ones.
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
    this.freshToken = null
    void this.loadConnector()
  }

  async loadConnector() {
    if (!account.token) {
      this.connector = null
      return
    }

    this.connector = await api.connector(account.token).catch(() => null)
    if (this.connector) this.llmReadOnly = this.connector.readOnly
  }

  /** Mints a token and shows it once. Any previous one stops working. */
  async createConnector(readOnly: boolean) {
    if (!account.token) return

    this.busy = true
    this.error = null

    try {
      const { token } = await api.issueConnector(account.token, readOnly)
      this.freshToken = token
      this.llmReadOnly = readOnly
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ readOnly }))
      await this.loadConnector()
    } catch (error) {
      this.error = message(error, 'could not create a token')
    } finally {
      this.busy = false
    }
  }

  async revokeConnector() {
    if (!account.token) return

    this.busy = true
    try {
      await api.revokeConnector(account.token)
      this.freshToken = null
      await this.loadConnector()
    } finally {
      this.busy = false
    }
  }

  async checkSubdomain(value: string) {
    if (!account.token || value.length < 2) {
      this.availability = { checking: false, available: null }
      return
    }

    this.availability = { checking: true, available: null }
    try {
      const result = await api.subdomainAvailable(account.token, value)
      this.availability = { checking: false, available: result.available, reason: result.reason }
    } catch {
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
      await account.loadSpaces()
    } finally {
      this.busy = false
    }
  }
}

export const settings = new Settings()
