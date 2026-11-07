import { landed } from '../glass/chrome.svelte'
import { isNumber, isRecord, isString, stored, storedText } from '../stored'
import { invoke, isDesktop } from '../tauri'
import { isExtensionPage, isWebAddress } from './address'
import { ASK_AGAIN, NOT_ANSWERING } from './answering'
import type { Cut } from './covers'
import type { NotArrived } from './heard'
import { Latest } from './latest'
import { placeOf, placeKept } from './place'
import type { Upgrade } from './upgrade'
import type { HalfTyped } from './typed'

function history(): Promise<typeof import('./visited').visited> {
  return import('./visited').then((module) => module.visited)
}

function stores(): Promise<typeof import('./web-data.svelte').webData> {
  return import('./web-data.svelte').then((module) => module.webData)
}

function pageDialogs(): Promise<typeof import('./dialogs.svelte')> {
  return import('./dialogs.svelte')
}

function dropDialogs(tab: string): void {
  if (!__EVEN_PLUGIN__) void pageDialogs().then(({ dialogs }) => dialogs.dropped(tab))
}

function pagePermissions(): Promise<typeof import('./permissions.svelte')> {
  return import('./permissions.svelte')
}

function dropGrants(tab: string, privateLeft: boolean): void {
  if (!__EVEN_PLUGIN__)
    void pagePermissions().then(({ grants }) => grants.dropped(tab, privateLeft))
}

function sleeping() {
  return import('./sleeping')
}

export const OUT_OF_THE_WAY = 20_000

const SHOT_KEEPS = 400

const LOOK_WAITS = 500

const SHOT_WAITS = 300

const ARRIVES = 3000

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Frame {
  window: { width: number; height: number }
  area: Rect
  pane: Rect
}

export interface Over {
  cut: Cut | null
  frame: Frame | null
  opacity?: number
  corner?: number
}

const WHOLE: Cut = { all: true, hollows: [] }

const NOTHING: Over = { cut: null, frame: null }

interface Placement {
  pane: Rect
  visible: boolean
  frame: Frame | null
  cut: Cut | null
  away?: boolean
  opacity?: number
  corner?: number | undefined
}

export type Layering = 'under' | 'cut' | 'hide'

let layering = $state<Layering>('hide')

function heard(page: Page, said: unknown): void {
  layering = said === 'under' ? 'under' : said === true ? 'cut' : 'hide'
  page.layering = layering
}

interface Looked {
  url: string
  x: number
  y: number
  trail: string[]
  at: number
  edited?: boolean
}

export type Step = 'back' | 'forward' | 'reload' | 'fresh' | 'stop'

interface Wanted {
  pane: Rect
  visible: boolean
  covering: boolean
  over: Over
}

export type Framing = 'card' | 'frame'

interface Moved {
  tab: string
  url: string
  title: string
  back: boolean
  forward: boolean
  loading: boolean
}

function readMoved(value: unknown): Moved | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.url !== 'string') return null

  return {
    tab: said.tab,
    url: said.url,
    title: typeof said.title === 'string' ? said.title : '',
    back: said.back === true,
    forward: said.forward === true,
    loading: said.loading === true,
  }
}

interface Iconed {
  tab: string
  icon: string
}

function readIconed(value: unknown): Iconed | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.icon !== 'string') return null

  return { tab: said.tab, icon: said.icon }
}

interface Opening {
  tab: string
  url: string
  behind: boolean
}

export function readChosen(value: unknown): string | null {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as { tab?: unknown }).tab === 'string'
    ? (value as { tab: string }).tab
    : null
}

export async function chooseTab(tab: string): Promise<void> {
  const { workspace } = await import('../workspace.svelte')
  if (workspace.activeTabId === tab || !workspace.tabs.some((one) => one.id === tab)) return
  workspace.activate(tab)
}

export function cardCorner(within?: Element | null): number {
  if (typeof document === 'undefined') return 0
  const card = within?.closest('[data-pane]')
  if (card) return parseFloat(getComputedStyle(card).getPropertyValue('--card-foot')) || 0
  const panes = document.querySelector('main') ?? document.documentElement
  return parseFloat(getComputedStyle(panes).getPropertyValue('--card-radius')) || 0
}

export function readOpening(value: unknown): Opening | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.url !== 'string') return null

  return isWebAddress(said.url) || isExtensionPage(said.url)
    ? { tab: said.tab, url: said.url, behind: said.behind === true }
    : null
}

export class Page {
  url = $state<string | null>(null)
  title = $state('')
  halfTyped: HalfTyped | null = null
  keyboard: 'address' | 'page' | null = null
  seen = false
  icon = $state<string | null>(null)
  kept = $state<string | null>(null)
  arriving = Infinity
  back = $state(false)
  forward = $state(false)
  loading = $state(false)
  openable = $state(true)
  crashed = $state(false)
  failure = $state<NotArrived | null>(null)
  rebuilding = false
  framing = $state<Framing>('card')

  live = $state(false)

  opening = false

  wanted: Wanted | null = null

  placing: Latest<Placement> | null = null

  sent: Placement | null = null

  upgrade: Upgrade | null = null

  typing = $state(false)

  shot = $state<string | null>(null)
  layering = $state<Layering>('hide')
  heldAt = $state.raw<Placement | null>(null)
  shotAt = 0
  shooting: Promise<void> | null = null

  shown = false

  path: string | null = null

  at: string | null = null

  landed: string | null = null

  titled = false

  space: string | null = null

  own: string | null = null

  pane: Rect | null = null

  notice = $state<string | null>(null)

  unplayable = $state(false)

  blocked = $state<string | null>(null)

  looked = Date.now()

  resting: ReturnType<typeof setTimeout> | undefined

  frozen = false
  lulling = Promise.resolve()
  edited = false
  heard = 0
  inPrivate = false
  store: string | null | undefined
  rehousing = Promise.resolve()

  marked(icon: string) {
    this.icon = icon || null
    if (icon && Date.now() <= this.arriving) this.kept = icon
  }

  loaded(loading: boolean) {
    this.arriving = loading ? Infinity : Date.now() + ARRIVES
  }

  onScreen = false

  lent = false

  playing = $state(false)
  muted = $state(false)
  filling = $state(false)
  zoom = $state(1)
  find = $state({ open: false, query: '', count: 0, at: -1 })
}

class Pages {
  private readonly held = new Map<string, Page>()

  private readonly gone = new Set<string>()

  private listening: Promise<void> | null = null

  each(): [string, Page][] {
    return [...this.held.entries()]
  }

  peek(tabId: string): Page | undefined {
    return this.held.get(tabId)
  }

  of(tabId: string): Page {
    const found = this.held.get(tabId)
    if (found) return found
    if (this.gone.has(tabId)) return new Page()

    void this.listen()

    const made = new Page()
    this.held.set(tabId, made)
    return made
  }

  iconOf(tabId: string): string | null {
    return this.held.get(tabId)?.icon ?? null
  }

  loadingOf(tabId: string): boolean {
    return this.held.get(tabId)?.loading ?? false
  }

  lentOf(tabId: string): boolean {
    return this.held.get(tabId)?.lent ?? false
  }

  async losing(tabId: string): Promise<boolean> {
    const page = this.held.get(tabId)
    if (!page?.live) return false
    await this.look(tabId)
    return page.edited || page.loading
  }

  addressOf(tabId: string): string | null {
    return this.held.get(tabId)?.url ?? null
  }

  typedInto(tabId: string): boolean {
    return (this.held.get(tabId)?.halfTyped ?? null) !== null
  }

  async show(
    tabId: string,
    url: string,
    pane: Rect,
    visible = true,
    over: Over = NOTHING,
  ): Promise<void> {
    this.gone.delete(tabId)
    const page = this.of(tabId)
    this.wake(page)
    page.url ??= url
    page.onScreen = true

    if (!isDesktop) {
      page.live = true
      return
    }

    await this.listen()

    if (page.crashed) return

    if (page.live) {
      await this.thaw(tabId)
      await this.place(tabId, pane, visible, !visible, over)
      return
    }

    if (page.opening) {
      page.wanted = { pane, visible, covering: !visible, over }
      return
    }

    await this.build(tabId, page, pane, visible, over)
  }

  async adopt(tabId: string, handing: () => Promise<void>): Promise<void> {
    this.gone.delete(tabId)
    const page = this.of(tabId)
    if (!isDesktop) {
      await handing()
      return
    }

    page.opening = true
    let handed = false
    try {
      await this.listen()
      await handing()
      handed = true
      page.live = true
      page.openable = true
      void this.bound()
    } catch {
      // Nothing to hand over: built below like any other.
    } finally {
      page.opening = false
    }

    const wanted = page.wanted
    page.wanted = null
    if (!wanted) return
    if (handed) await this.place(tabId, wanted.pane, wanted.visible, wanted.covering, wanted.over)
    else await this.build(tabId, page, wanted.pane, wanted.visible, wanted.over)
  }

  async build(
    tabId: string,
    page: Page,
    pane: Rect,
    visible: boolean,
    over: Over = NOTHING,
  ): Promise<void> {
    page.opening = true

    if (!visible) page.wanted = { pane, visible, covering: true, over }

    const kept = placeOf(page.path)
    const here = kept?.url === page.url ? kept : null
    const place = here ? { x: here.x, y: here.y } : null
    const trail = here?.trail ?? []

    page.pane = pane
    const tried = page.url
    const forOwn = page.own

    try {
      const store = page.inPrivate ? null : await (await stores()).store(forOwn)
      const said = await invoke<boolean | 'under' | undefined>('web_open', {
        tab: tabId,
        url: page.url,
        pane,
        revived: { place, trail, at: kept?.at ?? Math.max(0, trail.length - 1) },
        profile: { store, private: page.inPrivate },
      })
      heard(page, said)
      page.live = true
      page.openable = true
      page.frozen = false
      page.rebuilding = false
      page.store = store
      page.shown = true
      void this.bound()
    } catch (error) {
      if (error === NOT_ANSWERING) {
        setTimeout(() => {
          const asking = this.held.get(tabId) === page && !page.live && !page.opening
          if (asking && page.onScreen)
            void this.build(tabId, page, page.pane ?? pane, visible, over)
        }, ASK_AGAIN)
        return
      }
      await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
      if (page.rebuilding) {
        page.rebuilding = false
        page.crashed = true
      } else if (page.url === tried) page.openable = false
    } finally {
      page.opening = false
    }

    const wanted = page.wanted
    page.wanted = null
    if (page.live && page.crashed) {
      await this.ended(tabId)
      return
    }
    if (!page.live) {
      const moved = page.url !== tried && page.openable && this.held.get(tabId) === page
      if (moved && wanted) await this.build(tabId, page, wanted.pane, wanted.visible, wanted.over)
      return
    }

    if (this.held.get(tabId) !== page) {
      page.live = false
      await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
      return
    }

    if (page.own !== forOwn && !page.inPrivate) void this.rehouse(tabId, page.own)

    if (!wanted) return
    if (wanted.visible) await this.place(tabId, wanted.pane, true, false, wanted.over)
    else if (wanted.covering)
      await this.place(
        tabId,
        wanted.pane,
        false,
        page.layering === 'under' || (page.layering === 'cut' && wanted.over.cut !== null),
        wanted.over,
      )
    else this.hide(tabId, wanted.pane)
  }

  async place(
    tabId: string,
    pane: Rect,
    visible: boolean,
    covering = false,
    over: Over = NOTHING,
  ): Promise<void> {
    if (__EVEN_PLUGIN__) return
    const page = this.held.get(tabId)
    if (!isDesktop || !page) return

    if (page.opening) {
      page.wanted = { pane, visible, covering, over }
      return
    }

    if (!page.live && visible) return

    if (page.layering === 'under' && page.live) {
      const shown = visible || covering
      const cut = !shown ? null : covering ? (over.cut ?? WHOLE) : over.cut
      await this.put(tabId, page, {
        pane,
        visible: shown,
        frame: over.frame,
        cut,
        opacity: over.opacity ?? 1,
        corner: over.corner,
      })
      return
    }

    if (covering && page.layering === 'cut' && page.live && over.cut) {
      await this.cover(tabId, page, pane, over)
      return
    }

    if (covering) void this.shoot(tabId)

    await this.put(tabId, page, {
      pane,
      visible,
      frame: over.frame,
      cut: null,
      corner: over.corner,
    })
  }

  private async cover(tabId: string, page: Page, pane: Rect, over: Over): Promise<void> {
    if (__EVEN_PLUGIN__ || !over.cut) return
    if (page.shot === null || over.cut.all) void this.shoot(tabId)
    await this.put(tabId, page, {
      pane,
      visible: true,
      frame: over.frame,
      cut: over.cut,
      corner: over.corner,
    })
  }

  private async put(tabId: string, page: Page, one: Placement): Promise<void> {
    if (__EVEN_PLUGIN__) return
    page.placing ??= new Latest((sent) => this.send(tabId, page, sent))
    await page.placing.put(one).catch(() => undefined)
  }

  private async send(tabId: string, page: Page, one: Placement): Promise<void> {
    if (__EVEN_PLUGIN__) return
    page.sent = one
    try {
      const said = await invoke<boolean | 'under' | undefined>('web_place', {
        tab: tabId,
        pane: one.pane,
        visible: one.visible,
        frame: one.frame,
        cut: one.cut,
        corner: one.corner ?? cardCorner(),
        ...(one.opacity === undefined ? {} : { opacity: one.opacity }),
      })
      heard(page, said)
    } catch (error) {
      if (error === NOT_ANSWERING) {
        setTimeout(() => {
          if (this.held.get(tabId) === page && page.sent === one) void this.put(tabId, page, one)
        }, ASK_AGAIN)
        throw error
      }
      if (one.visible && !one.away) page.live = false
      throw error
    }
    if (one.away) return

    if (
      one.visible &&
      (page.pane?.width !== one.pane.width || page.pane.height !== one.pane.height)
    ) {
      page.shot = null
    }
    page.pane = one.pane
    page.shown = one.visible
  }

  get cuts(): boolean {
    return layering !== 'hide'
  }

  get under(): boolean {
    return layering === 'under'
  }

  still = $state(false)

  holdStill(): Promise<void> | null {
    this.still = true
    const shown = this.each().filter(([, page]) => this.heldWhere(page) !== null)
    if (shown.length === 0) return null
    return Promise.all(shown.map(([tabId, page]) => this.holdOne(tabId, page))).then(
      () => undefined,
    )
  }

  private heldWhere(page: Page): Placement | null {
    if (__EVEN_PLUGIN__ || !isDesktop || !page.live) return null
    return page.heldAt ?? (page.shown && page.sent?.visible ? page.sent : null)
  }

  private async holdOne(tabId: string, page: Page): Promise<void> {
    const at = this.heldWhere(page)
    if (!at) return
    if (!page.heldAt) {
      await this.shoot(tabId)
      if (!this.still) return
      page.heldAt = at
    }
    await this.put(
      tabId,
      page,
      page.layering === 'under' ? { ...at, cut: WHOLE } : { ...at, visible: false },
    )
  }

  async letGo(): Promise<void> {
    this.still = false
    await Promise.all(this.each().map(([tabId, page]) => this.letOneGo(tabId, page)))
  }

  private async letOneGo(tabId: string, page: Page): Promise<void> {
    const at = page.heldAt
    if (!at) return
    if (page.layering !== 'under') await this.put(tabId, page, at)
    if (!this.still) page.heldAt = null
  }

  hide(tabId: string, pane: Rect) {
    const page = this.held.get(tabId)
    if (!page) return
    page.onScreen = false
    page.looked = Date.now()

    if (isDesktop && page.live && (page.shooting || page.lent)) void this.aside(tabId, page, pane)
    else void this.place(tabId, pane, false)
    if (!isDesktop) return

    void this.look(tabId).then(() => this.rest(tabId))
  }

  async aside(tabId: string, page: Page, pane: Rect): Promise<void> {
    const away = { ...pane, x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY }
    await this.put(tabId, page, { pane: away, visible: true, frame: null, cut: null, away: true })
    await page.shooting
    if (!page.onScreen && !page.lent) await this.place(tabId, pane, false)
  }

  private async rest(tabId: string): Promise<void> {
    ;(await sleeping()).rest(this, tabId)
  }

  freeze(tabId: string) {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live || page.frozen || page.onScreen || page.lent) return
    page.frozen = true
    void sleeping().then((one) => one.lull(this, tabId, page, true))
  }

  async thaw(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.frozen) return page?.lulling

    this.wake(page)
    page.frozen = false
    const thawed = (await sleeping()).lull(this, tabId, page, false)
    if (!page.onScreen) void this.rest(tabId)
    return thawed
  }

  retime() {
    for (const [id, page] of this.held) if (!page.onScreen) void this.rest(id)
    void this.bound()
  }

  async park(tabId: string, hidden = false): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.live) return

    await this.look(tabId)
    if (hidden && page.onScreen) return
    page.live = false
    page.frozen = false
    page.loading = false
    page.playing = false
    clearTimeout(page.resting)
    await invoke('web_close', { tab: tabId, keep: true }).catch(() => undefined)
  }

  async ended(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (page?.opening) page.crashed = true
    if (!page?.live) return

    page.crashed = true
    page.live = false
    page.frozen = false
    page.loading = false
    page.playing = false
    page.back = false
    page.forward = false
    page.shot = null
    clearTimeout(page.resting)
    await invoke('web_close', { tab: tabId, keep: true }).catch(() => undefined)
  }

  async failed(tabId: string, not: NotArrived): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.live) return
    if (isWebAddress(not.url)) page.url = not.url
    page.failure = { ...not, url: page.url ?? not.url }
    await this.ended(tabId)
  }

  private async look(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    const said = await this.whereIs(tabId)
    if (!page || !said) return

    page.edited = said.edited === true
    if (!page.path || page.inPrivate) return
    placeKept(page.path, {
      url: said.url,
      x: said.x,
      y: said.y,
      trail: said.trail,
      at: said.at,
    })
  }

  private async whereIs(tabId: string): Promise<Looked | null> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live || page.frozen) return null

    try {
      return await Promise.race([
        invoke<Looked>('web_look', { tab: tabId }),
        new Promise<null>((go) => setTimeout(() => go(null), LOOK_WAITS)),
      ])
    } catch {
      return null
    }
  }

  async stepAddress(tabId: string, by: -1 | 1): Promise<string | null> {
    const said = await this.whereIs(tabId)
    return said?.trail[said.at + by] ?? null
  }

  async shoot(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live || !page.shown) return
    if (page.shot && Date.now() - page.shotAt < SHOT_KEEPS) return
    if (page.shooting) return page.shooting

    const taking = this.photograph(page, tabId)
    page.shooting = taking
    try {
      await taking
    } finally {
      page.shooting = null
    }
  }

  freshen(tabId: string): void {
    const page = this.held.get(tabId)
    if (!page || (page.shot && Date.now() - page.shotAt < SHOT_KEEPS)) return
    page.shot = null
    void this.shoot(tabId)
  }

  private async photograph(page: Page, tabId: string): Promise<void> {
    const { url, pane, shotAt } = page
    const same = (now: Rect | null) => now?.width === pane?.width && now?.height === pane?.height
    const asked = invoke<string | null>('web_shot', { tab: tabId })
    void asked.then(
      (said) => {
        if (said && page.shotAt === shotAt && page.url === url && same(page.pane)) {
          page.shot = said
          page.shotAt = Date.now()
        }
      },
      () => undefined,
    )
    try {
      await Promise.race([asked, new Promise<null>((go) => setTimeout(() => go(null), SHOT_WAITS))])
    } catch {
      // A platform with no way to photograph a webview. The hole keeps its own
      // ground, which is what it held before there was a picture to hold.
    }
  }

  private wake(page: Page) {
    clearTimeout(page.resting)
    page.resting = undefined
    page.looked = Date.now()
  }

  private async bound(): Promise<void> {
    ;(await sleeping()).bound(this)
  }

  async go(tabId: string, url: string, upgrade: Upgrade | null = null): Promise<void> {
    const page = this.of(tabId)
    if (!isWebAddress(url)) return

    page.upgrade = upgrade
    page.url = url
    page.openable = true
    page.crashed = false
    page.failure = null
    page.title = ''
    page.icon = null
    page.shot = null

    if (!isDesktop) {
      void this.saw(tabId, url, '')
      return
    }

    if (!page.live) return

    try {
      await invoke('web_navigate', { tab: tabId, url })
    } catch {
      // Not a page that has gone: the next placement finds that out, and opens the
      // address the tab already holds. See `place`.
    }
  }

  async step(tabId: string, step: Step, by = 1): Promise<void> {
    const page = this.held.get(tabId)
    if (page?.crashed && (step === 'reload' || step === 'fresh')) {
      await invoke('web_close', { tab: tabId, keep: true }).catch(() => undefined)
      page.rebuilding = true
      page.crashed = false
      page.failure = null
      return
    }
    if (!isDesktop || !page?.live) return
    page.upgrade = null

    await invoke('web_step', { tab: tabId, step, by }).catch(() => undefined)
  }

  async trail(tabId: string): Promise<{ urls: string[]; at: number }> {
    const none = { urls: [], at: 0 }
    if (!isDesktop || !this.held.get(tabId)?.live) return none

    return invoke<[string[], number]>('web_trail', { tab: tabId })
      .then(([urls, at]) => ({ urls, at }))
      .catch(() => none)
  }

  async zoom(tabId: string, factor: number): Promise<void> {
    if (!isDesktop || !this.held.get(tabId)?.live) return
    await invoke('web_zoom', { tab: tabId, factor }).catch(() => undefined)
  }

  async print(tabId: string): Promise<void> {
    if (!isDesktop || !this.held.get(tabId)?.live) return
    await invoke('web_print', { tab: tabId }).catch(() => undefined)
  }

  async read(
    tabId: string,
    selection: boolean,
  ): Promise<{ url: string; title: string; html: string } | null> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return null

    try {
      return await invoke<{ url: string; title: string; html: string }>('web_clip', {
        tab: tabId,
        selection,
      })
    } catch {
      return null
    }
  }

  private async saw(tabId: string, url: string, title: string): Promise<void> {
    if (this.held.get(tabId)?.inPrivate) return
    const [visited, webData] = await Promise.all([history(), stores()])
    visited.saw(webData.history(), tabId, url, title)
  }

  apart(): string[] {
    return [...this.held.values()].map((page) => page.own).filter((one) => one !== null)
  }

  rehouse(tabId: string, own: string | null, said: string | null = null): Promise<void> {
    const page = this.held.get(tabId)
    if (!page) return Promise.resolve()
    page.own = own
    const moving = page.rehousing.then(() => this.moved(tabId, page, said))
    page.rehousing = moving.catch(() => undefined)
    return moving
  }

  private async moved(tabId: string, page: Page, said: string | null): Promise<void> {
    if (this.held.get(tabId) !== page || page.inPrivate) return
    const store = await (await stores()).store(page.own)
    if (!page.live || store === page.store) return

    const shown = page.shown ? page.pane : null
    page.opening = true
    try {
      await this.park(tabId)
    } finally {
      page.opening = false
    }

    const wanted = page.wanted
    page.wanted = null
    const pane = wanted?.pane ?? shown
    if (pane && page.url && this.held.get(tabId) === page)
      await this.build(tabId, page, pane, wanted?.visible ?? true, wanted?.over)
    page.notice = said
  }

  private anyPrivate(): boolean {
    return [...this.held.values()].some((page) => page.inPrivate)
  }

  forget(tabId: string) {
    this.gone.add(tabId)
    const page = this.held.get(tabId)
    if (!page) return

    clearTimeout(page.resting)
    void history().then((visited) => visited.left(tabId))
    this.asked.delete(tabId)
    if (page.inPrivate) void import('./sites').then(({ forgetAside }) => forgetAside(tabId))

    if (!isDesktop || !page.live) {
      this.held.delete(tabId)
      dropGrants(tabId, this.anyPrivate())
      dropDialogs(tabId)
      if (isDesktop) void invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
      return
    }

    void this.closing(tabId)
  }

  private async closing(tabId: string): Promise<void> {
    await this.look(tabId)

    this.held.delete(tabId)
    dropGrants(tabId, this.anyPrivate())
    dropDialogs(tabId)
    await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
  }

  keepOnly(ids: readonly string[]) {
    const kept = new Set(ids)
    for (const tabId of [...this.held.keys()]) {
      if (!kept.has(tabId)) this.forget(tabId)
    }
  }

  private readonly asked = new Map<string, string>()

  openBlocked(tabId: string): void {
    const page = this.held.get(tabId)
    const url = page?.blocked
    if (!page || !url) return
    page.blocked = null
    void this.openAsked({ tab: tabId, url, behind: false })
  }

  private async openAsked(said: Opening): Promise<void> {
    const { workspace } = await import('../workspace.svelte')
    const opened = workspace.openPage(said.url, said.behind ? 'behind' : 'front', said.tab)
    if (opened !== null) this.asked.set(opened, said.tab)
  }

  private async downloaded(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    const opener = this.asked.get(tabId)
    if (opener === undefined || !page || page.titled) return

    const { closeItself } = await import('./self-close')
    await closeItself(tabId, opener)
  }

  private listen(): Promise<void> {
    if (__EVEN_PLUGIN__ || !isDesktop || typeof window === 'undefined') return Promise.resolve()
    this.listening ??= (async () => {
      const { hearHere: listen } = await import('../own-window')

      const { grants, readAsked } = await pagePermissions()
      await listen('nib://web-ask', (event) => {
        const said = readAsked(event.payload)
        const page = said ? this.held.get(said.tab) : undefined
        if (said && page) grants.heard({ ...said, privately: page.inPrivate })
      })

      const { dialogs, readDialog } = await pageDialogs()
      await listen('nib://web-dialog', (event) => {
        const said = readDialog(event.payload)
        if (said && this.held.has(said.tab)) dialogs.heard(said)
      })

      await listen('nib://web-open', (event) => {
        const said = readOpening(event.payload)
        if (said && this.held.has(said.tab)) void this.openAsked(said)
      })
      await listen('nib://web-chosen', (event) => {
        const tab = readChosen(event.payload)
        if (tab !== null && this.held.has(tab)) void chooseTab(tab)
      })
      await listen('nib://web-blocked', (event) => {
        const said = readOpening(event.payload)
        const page = said && this.held.get(said.tab)
        if (said && page) page.blocked = said.url
      })
      const { readPressed, replay } = await import('./keys')
      await listen('nib://web-key', (event) => {
        const one = readPressed(event.payload)
        if (one) replay(one)
      })
      const { downloads, readDownload } = await import('./downloads.svelte')
      await listen('nib://web-download', (event) => {
        const said = readDownload(event.payload)
        if (said && downloads.heard(said)) void this.downloaded(said.tab)
      })
      await listen('nib://web-icon', (event) => {
        const said = readIconed(event.payload)
        const page = said ? this.held.get(said.tab) : undefined
        if (!said || !page) return

        page.marked(said.icon)
        const at = page.at ?? page.url
        if (said.icon && !page.inPrivate) {
          void import('./favicons').then((one) => one.saw(at, said.icon))
          const title = page.title
          void import('./site-icons.svelte').then((one) => one.siteIcons.saw(at, title, said.icon))
        }
        const path = page.path
        if (said.icon && path) {
          void Promise.all([import('./favicons'), import('../chosen-icon')]).then(([one, files]) =>
            one.saw(files.addressOf(path), said.icon),
          )
        }
      })
      await (
        await import('./heard')
      ).listening(
        listen,
        (tab) => this.held.get(tab),
        (tab, url) => void this.go(tab, url),
        (tab) => void this.ended(tab),
        (tab, not) => void this.failed(tab, not),
      )
      await listen('nib://web-tab', (event) => {
        const said = readMoved(event.payload)
        if (!said) return

        const page = this.held.get(said.tab)
        if (!page) return

        const was = page.loading
        const moved = said.url !== '' && said.url !== page.at
        if (moved || (said.loading && !was)) {
          page.unplayable = false
          page.blocked = null
        }
        page.loading = said.loading
        if (said.loading !== was) page.loaded(said.loading)
        page.back = said.back
        page.forward = said.forward
        if (said.url) page.at = said.url
        if (said.url && !page.typing) page.url = said.url
        if (said.title) {
          page.title = said.title
          page.titled = true
        }
        if (said.url) void this.saw(said.tab, said.url, said.title)

        if (was && !said.loading) {
          page.landed ??= page.url
          page.shot = null
          void this.shoot(said.tab)
        }
        if ((was || moved) && !said.loading) landed(said.tab)
      })
    })()
    return this.listening
  }
}

export const pages = new Pages()

export const MARKS = 'nib:favicons'
export const MARK = 'nib:favicon:'

export function drawable(picture: string): boolean {
  return (
    picture.length <= 22 * 1024 && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(picture)
  )
}

export type Seen = [picture: string, used: number]

export function keysOf(url: string | null | undefined): [string, string] | null {
  if (!url) return null

  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away
    const at = new URL(url)
    if (at.protocol !== 'https:' && at.protocol !== 'http:') return null
    return [at.origin + at.pathname, at.origin]
  } catch {
    return null
  }
}

class Favicons {
  changed = $state(0)
  readonly sizes = new Map<string, number>()
  readonly pictures = new Map<string, string | null>()
  readonly unwritten = new Map<string, string>()

  private held: Map<string, Seen> | null = null

  index(): Map<string, Seen> {
    if (this.held) return this.held

    this.held = new Map()
    const saved = stored(MARKS)
    if (!isRecord(saved) || !isRecord(saved.pages) || !isRecord(saved.sizes)) return this.held

    for (const [key, one] of Object.entries(saved.pages)) {
      if (Array.isArray(one) && isString(one[0]) && isNumber(one[1])) {
        this.held.set(key, [one[0], one[1]])
      }
    }
    for (const [id, size] of Object.entries(saved.sizes)) {
      if (isNumber(size)) this.sizes.set(id, size)
    }
    return this.held
  }

  private picture(id: string): string | null {
    let found = this.pictures.get(id)
    if (found === undefined) {
      const text = storedText(MARK + id)
      found = text !== null && drawable(text) ? text : null
      this.pictures.set(id, found)
    }
    return found
  }

  of(url: string | null | undefined): string | null {
    const keys = this.changed >= 0 ? keysOf(url) : null
    if (!keys) return null

    const index = this.index()
    for (const key of keys) {
      const held = index.get(key)
      const picture = held ? this.picture(held[0]) : null
      if (!held || !picture) continue

      if (Date.now() - held[1] > 86_400_000) {
        held[1] = Date.now()
        void import('./favicons').then((one) => one.later())
      }
      return picture
    }
    return null
  }
}

export const favicons = new Favicons()

export function siteMark(
  live: string | null | undefined,
  url: string | null | undefined,
  written?: string | null,
): string | null {
  return live ?? favicons.of(url) ?? written ?? null
}
