import { keepJson, stored, invoke, isDesktop, platform } from '../../platform/src/api'
import { ASK_AGAIN, NOT_ANSWERING } from './answering'

export const runsExtensions = isDesktop && (platform() === 'windows' || platform() === 'linux')

export interface Gaps {
  said: string[]
  apis: string[]
}

export interface Extension {
  id: string
  store: 'chrome' | 'edge' | 'firefox'
  addon: string | null
  version: string
  enabled: boolean
  pinned: boolean
  name: string
  picture: string | null
  popup: string | null
  options: string | null
  action: boolean
  permissions: string[]
  problem: string | null
  gaps: Gaps | null
  pending: boolean
}

interface Asking {
  link: string
  name: string
  gaps: Gaps
}

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

function readGaps(value: unknown): Gaps | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const words = (field: unknown) =>
    Array.isArray(field) ? field.filter((one): one is string => typeof one === 'string') : []
  const gaps = { said: words(said.said), apis: words(said.apis) }
  return gaps.said.length || gaps.apis.length ? gaps : null
}

export const GAP_WORDS: Record<string, string> = {
  blocking: 'It can’t block or change what pages load.',
  containers: 'Its containers are its own: tabs don’t open in them.',
  sidebar: 'Its sidebar opens as a tab.',
  hiddenTabs: 'Tabs it hides stay in the tab bar.',
}

function readAsks(value: unknown): { name: string; gaps: Gaps } | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const gaps = readGaps(said.asks)
  return gaps ? { name: typeof said.name === 'string' ? said.name : '', gaps } : null
}

export function pinnedOf(list: readonly Extension[]): Extension[] {
  return list.filter((one) => one.enabled && one.action && one.pinned && !one.pending)
}

export const UPDATE_EVERY = 5 * 60 * 60 * 1000

const LOOKED = 'orden.extensions.looked'

export function updateDue(last: number | null, now: number): boolean {
  return last === null || now - last >= UPDATE_EVERY || now < last
}

export interface Popped {
  id: string
  tab: string
  store: string | null | undefined
}

interface PopupRect {
  x: number
  y: number
  width: number
  height: number
}

class Extensions {
  list = $state<Extension[]>([])
  read = $state(false)
  installing = $state<string | null>(null)
  failed = $state<string | null>(null)
  asking = $state<Asking | null>(null)
  popped = $state<Popped | null>(null)

  private listening = false
  private asked = 0
  private moves = 0
  private moving: Promise<unknown> = Promise.resolve()
  private readonly problems = new Set<string>()

  async start(): Promise<void> {
    if (!isDesktop || this.listening) return
    this.listening = true
    const { listen } = await import('@tauri-apps/api/event')
    await listen('orden://extensions', () => void this.load())
    await this.load()
    this.lookForUpdates()
  }

  async load(): Promise<void> {
    const mine = ++this.asked
    let said: unknown[]
    for (;;) {
      const moves = this.moves
      said = await invoke<unknown[]>('extensions_list').catch(() => [])
      if (mine !== this.asked) return
      if (moves === this.moves) break
      await this.moving
      if (mine !== this.asked) return
    }
    this.list = said.map(readExtension).filter((one): one is Extension => one !== null)
    this.problems.clear()
    this.read = true
  }

  async install(link: string, anyway = false): Promise<boolean> {
    this.installing = link
    this.failed = null
    this.asking = null
    try {
      const asks = readAsks(await invoke<unknown>('extensions_install', { link, anyway }))
      if (asks) {
        this.asking = { link, ...asks }
        return false
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
      if (this.installing === link) this.installing = null
    }
  }

  async enable(id: string, enabled: boolean): Promise<void> {
    this.change(id, { enabled })
    await this.moved(invoke('extensions_set', { id, enabled }))
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    this.change(id, { pinned })
    await this.moved(invoke('extensions_set', { id, pinned }))
  }

  async remove(id: string): Promise<void> {
    if (this.popped?.id === id) this.close()
    this.list = this.list.filter((one) => one.id !== id)
    await this.moved(invoke('extensions_remove', { id }))
  }

  async optionsOf(id: string): Promise<string | null> {
    return invoke<string>('extensions_page', { id, options: true }).catch(() => null)
  }

  async named(url: string): Promise<string | null> {
    const said = await invoke<[string, string] | null>('extensions_named', { link: url }).catch(
      () => null,
    )
    return said ? said[1] : null
  }

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

  private async moved(sent: Promise<unknown>): Promise<void> {
    this.moves++
    const settled = sent.then(
      () => true,
      () => false,
    )
    this.moving = Promise.all([this.moving, settled]).then(() => undefined)
    if (!(await settled)) await this.load()
  }

  private change(id: string, fields: Partial<Extension>) {
    this.list = this.list.map((one) => (one.id === id ? { ...one, ...fields } : one))
  }

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
