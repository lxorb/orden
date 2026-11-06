/** The extensions the web tabs run, as the bar, its bubble and Settings draw them.
 *
 *  The crate installs, checks, unpacks and hands each one to the engine; see
 *  src-tauri/src/extensions.rs. This is the list it answers with, the few things a
 *  reader does to a row, and the popup that is open, if one is. Fetched with the first
 *  web tab and never in the first paint: nothing here matters before a page is open. */

import { keepJson, stored } from '../stored'
import { invoke, isDesktop, platform } from '../tauri'
import type { BrowserTheme } from '../themes/browser'
import { ASK_AGAIN, NOT_ANSWERING } from './answering'

/** Whether this build's engine runs extensions in web tabs: `WebView2` on Windows and
 *  nib's own Chromium on Linux, the crate's `SUPPORTED`; a Mac's engine has no extension
 *  API. On Linux they could be installed from a store's own page and then neither seen
 *  nor removed, since the bar's button and the Settings list were Windows' alone (#789). */
export const runsExtensions = isDesktop && (platform() === 'windows' || platform() === 'linux')

/** What of a Firefox add-on does not run in Orden, as the crate reads it off the add-on
 *  (src-tauri/src/extensions/firefox.rs): what is said in a sentence of its own, and the
 *  other Firefox-only parts by name. */
export interface Gaps {
  said: string[]
  apis: string[]
}

/** One extension, as the crate describes it. */
export interface Extension {
  id: string
  store: 'chrome' | 'edge' | 'firefox'
  /** The slug addons.mozilla.org names a Firefox add-on by. */
  addon: string | null
  version: string
  enabled: boolean
  pinned: boolean
  name: string
  /** Its picture, as a `data:` address. */
  picture: string | null
  /** Whether it has a page its button opens. */
  popup: string | null
  options: string | null
  /** Whether it has a button at all. */
  action: boolean
  /** What it asks to be allowed, in Chromium's own words. */
  permissions: string[]
  /** Why it did not load this run, if it did not. */
  problem: string | null
  /** What of a Firefox add-on does not run in Orden. */
  gaps: Gaps | null
  /** Whether it starts with Orden's next launch: a Firefox add-on on Linux, whose engine
   *  loads one only as it starts. */
  pending: boolean
}

/** What a Firefox add-on that does not run whole is, while the reader decides. */
export interface Asking {
  link: string
  name: string
  gaps: Gaps
}

/** An extension out of what the crate sent, or null for anything that is not one. */
export function readExtension(value: unknown): Extension | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (typeof said.id !== 'string' || typeof said.version !== 'string') return null

  const text = (field: unknown) => (typeof field === 'string' && field ? field : null)
  return {
    id: said.id,
    store: said.store === 'edge' || said.store === 'firefox' ? said.store : 'chrome',
    addon: text(said.addon),
    version: said.version,
    enabled: said.enabled !== false,
    pinned: said.pinned !== false,
    name: text(said.name) ?? said.id,
    picture: text(said.picture),
    popup: text(said.popup),
    options: text(said.options),
    action: said.action === true,
    permissions: Array.isArray(said.permissions)
      ? said.permissions.filter((one): one is string => typeof one === 'string')
      : [],
    problem: text(said.problem),
    gaps: readGaps(said.gaps),
    pending: said.pending === true,
  }
}

/** What does not run, out of what the crate sent, or null for nothing. */
export function readGaps(value: unknown): Gaps | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const words = (field: unknown) =>
    Array.isArray(field) ? field.filter((one): one is string => typeof one === 'string') : []
  const gaps = { said: words(said.said), apis: words(said.apis) }
  return gaps.said.length || gaps.apis.length ? gaps : null
}

/** The sentence each part a Firefox add-on cannot run is said in; see `Gaps`. */
export const GAP_WORDS: Record<string, string> = {
  blocking: 'It can’t block or change what pages load.',
  containers: 'Its containers are its own: tabs don’t open in them.',
  sidebar: 'Its sidebar opens as a tab.',
  hiddenTabs: 'Tabs it hides stay in the tab bar.',
}

/** What an install came to, out of what the crate answered. */
export function readDone(
  value: unknown,
): { asks: { name: string; gaps: Gaps } } | { theme: BrowserTheme } | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const gaps = readGaps(said.asks)
  if (gaps) return { asks: { name: typeof said.name === 'string' ? said.name : '', gaps } }
  const theme = said.theme as Record<string, unknown> | undefined
  if (typeof theme?.name === 'string' && typeof theme.source === 'string') {
    return { theme: { name: theme.name, source: theme.source, css: false, pages: '' } }
  }
  return null
}

/** The buttons the bar shows: what is on, has a button and is pinned, and runs already. */
export function pinnedOf(list: readonly Extension[]): Extension[] {
  return list.filter((one) => one.enabled && one.action && one.pinned && !one.pending)
}

/** How long between two looks for newer versions: Chrome looks every five hours. */
export const UPDATE_EVERY = 5 * 60 * 60 * 1000

/** Where the last look was written down. */
const LOOKED = 'nib.extensions.looked'

/** Whether it is time to look for newer versions, given when the last look was. */
export function updateDue(last: number | null, now: number): boolean {
  return last === null || now - last >= UPDATE_EVERY || now < last
}

/** A popup that is open: which extension, over which tab. */
export interface Popped {
  id: string
  tab: string
  store: string | null | undefined
}

/** Where the window wants a popup's page, in its own coordinates. */
export interface PopupRect {
  x: number
  y: number
  width: number
  height: number
}

class Extensions {
  list = $state<Extension[]>([])
  /** Whether the crate has answered once. */
  read = $state(false)
  /** A link being installed, so its row can say so. */
  installing = $state<string | null>(null)
  /** Why the last install did not work. */
  failed = $state<string | null>(null)
  /** A Firefox add-on that does not run whole, until the reader installs it or not. */
  asking = $state<Asking | null>(null)
  /** The popup that is open. */
  popped = $state<Popped | null>(null)

  private listening = false
  /** The extensions whose problem is a popup that could not be opened this run, rather
   *  than the crate's, so a popup that opens takes only that one away. */
  private readonly problems = new Set<string>()

  /** Reads the list, and from then on hears about every change to it. */
  async start(): Promise<void> {
    if (!isDesktop || this.listening) return
    this.listening = true
    const { listen } = await import('@tauri-apps/api/event')
    await listen('nib://extensions', () => void this.load())
    await this.load()
    this.lookForUpdates()
  }

  async load(): Promise<void> {
    const said = await invoke<unknown[]>('extensions_list').catch(() => [])
    this.list = said.map(readExtension).filter((one): one is Extension => one !== null)
    this.problems.clear()
    this.read = true
  }

  /** Installs what a store link or an id names. Answers whether it worked. A Firefox
   *  add-on that does not run whole waits in `asking` until `install` is asked again with
   *  `anyway`; a Firefox theme becomes one of Orden's. */
  async install(link: string, anyway = false): Promise<boolean> {
    this.installing = link
    this.failed = null
    this.asking = null
    try {
      const done = readDone(await invoke<unknown>('extensions_install', { link, anyway }))
      if (done && 'asks' in done) {
        this.asking = { link, ...done.asks }
        return false
      }
      if (done && 'theme' in done) {
        const { wearFirefoxTheme } = await import('../themes/kept')
        await wearFirefoxTheme(done.theme)
        return true
      }
      await this.load()
      return true
    } catch (error) {
      this.failed =
        typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : 'that did not work'
      return false
    } finally {
      this.installing = null
    }
  }

  /** Turns one on or off. Shown at once, put right if the crate refuses. */
  async enable(id: string, enabled: boolean): Promise<void> {
    this.change(id, { enabled })
    await invoke('extensions_set', { id, enabled }).catch(() => this.load())
  }

  /** Pins or unpins one's button. */
  async pin(id: string, pinned: boolean): Promise<void> {
    this.change(id, { pinned })
    await invoke('extensions_set', { id, pinned }).catch(() => this.load())
  }

  async remove(id: string): Promise<void> {
    if (this.popped?.id === id) this.close()
    this.list = this.list.filter((one) => one.id !== id)
    await invoke('extensions_remove', { id }).catch(() => this.load())
  }

  /** The address of one's options page, for a tab. */
  async optionsOf(id: string): Promise<string | null> {
    return invoke<string>('extensions_page', { id, options: true }).catch(() => null)
  }

  /** Whether an address is a store's page for an extension, and which. */
  async named(url: string): Promise<string | null> {
    const said = await invoke<[string, string] | null>('extensions_named', { link: url }).catch(
      () => null,
    )
    return said ? said[1] : null
  }

  /** Opens one's popup over `tab`. */
  open(id: string, tab: string, store: string | null | undefined): void {
    this.pop(this.popped?.id === id && this.popped.tab === tab ? null : { id, tab, store })
  }

  close(which?: Popped): void {
    if (!which || this.popped === which) this.pop(null)
  }

  private pop(next: Popped | null) {
    if (this.popped) void invoke('extension_popup_close').catch(() => undefined)
    this.popped = next
  }

  /** Builds the open popup's page where `at` says, while it is still the one open: asked
   *  again every second while the tab's browser is too busy to answer, as a browser's
   *  popup waits on a busy browser, and a popup that cannot be opened at all closes and
   *  says why on its extension's button. Nothing a popup does takes the app with it. */
  async build(popped: Popped, at: () => PopupRect | null): Promise<string | null> {
    for (;;) {
      const rect = at()
      if (this.popped !== popped || !rect) return null
      try {
        const label =
          (await invoke<string | null>('extension_popup_open', {
            id: popped.id,
            tab: popped.tab,
            store: popped.store ?? null,
            rect,
          })) ?? null
        if (this.popped !== popped) return null
        // Closed while it was being built: its bubble has gone, and so does the page.
        if (!at()) {
          if (label) await invoke('extension_popup_close', { label }).catch(() => undefined)
          return null
        }
        if (this.problems.delete(popped.id)) this.change(popped.id, { problem: null })
        return label
      } catch (error) {
        if (this.popped !== popped) return null
        if (error === NOT_ANSWERING) {
          await new Promise((done) => setTimeout(done, ASK_AGAIN))
          continue
        }
        const why = typeof error === 'string' && error ? error : 'that popup could not be opened'
        this.problems.add(popped.id)
        this.change(popped.id, { problem: why })
        this.close(popped)
        return null
      }
    }
  }

  private change(id: string, fields: Partial<Extension>) {
    this.list = this.list.map((one) => (one.id === id ? { ...one, ...fields } : one))
  }

  /** Newer versions, once in a while and never at the launch: the stores are asked
   *  after the first web tab has settled, the way a browser looks some minutes in. */
  private lookForUpdates() {
    const last = stored(LOOKED)
    if (!updateDue(typeof last === 'number' ? last : null, Date.now())) return
    setTimeout(() => {
      keepJson(LOOKED, Date.now())
      void invoke<number>('extensions_update')
        .then((moved) => (moved > 0 ? this.load() : undefined))
        .catch(() => undefined)
    }, 60_000)
  }
}

export const extensions = new Extensions()
