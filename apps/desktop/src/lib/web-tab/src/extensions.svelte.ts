import { keepJson, stored, invoke, isDesktop, isRecord } from '../../platform/src/api'
import { ASK_AGAIN, NOT_ANSWERING } from './answering'

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
  cannotRun: string | null
}
interface Asking {
  link: string
  name: string
  gaps: Gaps
}
export function readExtension(said: unknown): Extension | null {
  if (!isRecord(said) || typeof said.id !== 'string' || typeof said.version !== 'string') return null
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
    permissions: words(said.permissions),
    problem: text(said.problem),
    gaps: readGaps(said.gaps),
    pending: said.pending === true,
    cannotRun: text(said.cannotRun),
  }
}
function words(field: unknown): string[] {
  return Array.isArray(field) ? field.filter((one): one is string => typeof one === 'string') : []
}
function readGaps(said: unknown): Gaps | null {
  if (!isRecord(said)) return null
  const gaps = { said: words(said.said), apis: words(said.apis) }
  return gaps.said.length || gaps.apis.length ? gaps : null
}
export const GAP_WORDS: Record<string, string> = {
  blocking: 'It can’t block or change what pages load.',
  containers: 'Its containers are its own: tabs don’t open in them.',
  sidebar: 'Its sidebar opens as a tab.',
  hiddenTabs: 'Tabs it hides stay in the tab bar.',
}
function readAsks(said: unknown): { name: string; gaps: Gaps } | null {
  if (!isRecord(said)) return null
  const gaps = readGaps(said.asks)
  return gaps ? { name: typeof said.name === 'string' ? said.name : '', gaps } : null
}
export const PENDING_SAID = 'Starts when Orden next opens'
export const OFF_SAID = 'Turns off when Orden next opens'
export const UNKNOWN_ANSWER = 'Orden could not install that extension: it got an answer it does not know'
export const POPUP_UNKNOWN = 'Orden closed this popup: it got an answer it does not know'
export const NOT_WORKING = 'Not working'
export function runs(one: Extension): boolean {
  return !one.pending && one.cannotRun === null
}
export function pinnedOf(list: readonly Extension[]): Extension[] {
  return list.filter((one) => one.enabled && one.action && one.pinned && runs(one))
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
export type PopupSaid =
  { kind: 'size'; width: number; height: number } | { kind: 'closed' } | { kind: 'failed'; problem: string }
export function readPopupSaid(said: unknown): PopupSaid {
  if (!isRecord(said)) return { kind: 'failed', problem: POPUP_UNKNOWN }
  if (said.kind === 'closed') return { kind: 'closed' }
  if (said.kind === 'failed') {
    const problem = typeof said.problem === 'string' && said.problem.trim() ? said.problem : POPUP_UNKNOWN
    return { kind: 'failed', problem }
  }
  const { width, height } = said
  if (said.kind === 'size' && typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return { kind: 'size', width, height }
  }
  return { kind: 'failed', problem: POPUP_UNKNOWN }
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
  said = $state<string | null>(null)
  shownIn = $state<string | null>(null)
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
      const answer = await invoke<unknown>('extensions_list').catch(() => [])
      said = Array.isArray(answer) ? answer : []
      if (mine !== this.asked) return
      if (moves === this.moves) break
      await this.moving
      if (mine !== this.asked) return
    }
    this.list = said.map(readExtension).filter((one): one is Extension => one !== null)
    this.problems.clear()
    this.read = true
  }
  async restart(): Promise<void> {
    try {
      await invoke('extensions_restart')
    } catch (error) {
      this.failed = `Orden could not restart: ${typeof error === 'string' ? error : error instanceof Error ? error.message : 'that did not work'}`
    }
  }
  installFrom(tab: string, link: string): Promise<boolean> {
    this.shownIn = tab
    return this.install(link)
  }
  async install(link: string, anyway = false): Promise<boolean> {
    this.installing = link
    this.failed = null
    this.said = null
    this.asking = null
    try {
      const answer = await invoke<unknown>('extensions_install', { link, anyway })
      const asks = readAsks(answer)
      if (asks) {
        this.asking = { link, ...asks }
        return false
      }
      const installed = readExtension(answer)
      if (installed) {
        await this.load()
        if (installed.pending) this.said = PENDING_SAID
        return true
      }
      this.failed = UNKNOWN_ANSWER
      return false
    } catch (error) {
      this.failed = typeof error === 'string' ? error : error instanceof Error ? error.message : 'that did not work'
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
    const said = await invoke<[string, string] | null>('extensions_named', { link: url }).catch(() => null)
    return said ? said[1] : null
  }
  open(id: string, tab: string, store: string | null | undefined): void {
    const one = this.list.find((each) => each.id === id)
    if (one && !runs(one)) return
    this.pop(this.popped?.id === id && this.popped.tab === tab ? null : { id, tab, store })
  }
  close(which?: Popped): void {
    if (!which || this.popped === which) this.pop(null)
  }
  heardPopup(popped: Popped, said: unknown): { width: number; height: number } | null {
    const one = readPopupSaid(said)
    if (one.kind === 'size') return { width: one.width, height: one.height }
    this.close(popped)
    if (one.kind === 'failed') {
      this.change(popped.id, { problem: one.problem })
      void this.load()
    }
    return null
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
