import { providePort } from '@orden/contracts'
import { landed } from '../../theme/src/api'
import { replay } from '../../ui-kit/src/api'
import { isNumber, isRecord, isString, stored, storedText, invoke, isDesktop } from '../../platform/src/api'
import { isExtensionPage, isWebAddress, keysOf } from '@orden/scan/web-address'
import { ASK_AGAIN, NOT_ANSWERING } from './answering'
import type { Cut } from './covers'
import type { NotArrived } from './heard'
import { Latest } from './latest'
import { placeOf, placeKept } from './place'
import type { Upgrade } from './upgrade'
import type { HalfTyped } from '@orden/scan/typed'

function history(): Promise<typeof import('./visited').visited> {
  return import('./visited').then((module) => module.visited)
}
function stores(): Promise<typeof import('./web-data.svelte').webData> {
  return import('./web-data.svelte').then((module) => module.webData)
}
function pagePermissions(): Promise<typeof import('./permissions.svelte')> {
  return import('./permissions.svelte')
}
function leftPrivate(privateLeft: boolean): void {
  if (!privateLeft) void pagePermissions().then(({ grants }) => grants.leftPrivate())
}
function shut(tab: string, keep: boolean): Promise<unknown> {
  return invoke('web_close', { tab, keep }).catch(() => undefined)
}
function still(): Promise<typeof import('./still')> {
  return import('./still')
}
function sleeping() {
  return import('./sleeping')
}
export const OUT_OF_THE_WAY = 20_000
const SHOT_KEEPS = 400
const LOOK_WAITS = 500
const COVER_HIDES = 5000
const DRAWN_AWAY = 120
const BLANK_WAITS = 3000
const AFTER_COMMIT = 1200
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
export type Foot = readonly [left: number, right: number]
export interface Over {
  cut: Cut | null
  frame: Frame | null
  corner?: Foot
}
const WHOLE: Cut = { all: true, hollows: [] }
const NOTHING: Over = { cut: null, frame: null }
export function awayFrom(pane: Rect): Placement {
  const away = { ...pane, x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY }
  return { pane: away, visible: true, frame: null, cut: WHOLE, away: true }
}
interface Placement {
  pane: Rect
  visible: boolean
  frame: Frame | null
  cut: Cut | null
  away?: boolean
  corner?: Foot | undefined
}
export type Layering = 'cut' | 'hollows' | 'hide'
let layering = $state<Layering>('hide')
function heard(page: Page, said: unknown): void {
  layering = said === 'hollows' ? said : said === true ? 'cut' : 'hide'
  page.layering = layering
}
const cutsOut = (layering: Layering, cut: Cut | null): boolean =>
  cut !== null && (layering === 'cut' || (layering === 'hollows' && !cut.all))
const goesAway = (layering: Layering): boolean => layering === 'hide' || layering === 'hollows'
interface Looked {
  url: string
  x: number
  y: number
  trail: string[]
  at: number
  edited?: boolean
}
interface Clipped {
  url: string
  title: string
  html: string
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
function readMoved(said: unknown): Moved | null {
  if (!isRecord(said) || !isString(said.tab) || !isString(said.url)) return null
  return {
    tab: said.tab,
    url: said.url,
    title: isString(said.title) ? said.title : '',
    back: said.back === true,
    forward: said.forward === true,
    loading: said.loading === true,
  }
}
interface Iconed {
  tab: string
  icon: string
}
function readIconed(said: unknown): Iconed | null {
  return isRecord(said) && isString(said.tab) && isString(said.icon) ? { tab: said.tab, icon: said.icon } : null
}
interface Opening {
  tab: string
  url: string
  behind: boolean
}
export function readChosen(value: unknown): string | null {
  return isRecord(value) && isString(value.tab) ? value.tab : null
}
export async function chooseTab(tab: string): Promise<void> {
  const { workspace } = await import('../../workspace/src/api')
  if (workspace.activeTabId === tab || !workspace.tabs.some((one) => one.id === tab)) return
  workspace.activate(tab)
}
export function cardCorner(within?: Element | null): Foot {
  if (typeof document === 'undefined') return [0, 0]
  const card = within?.closest('[data-pane]')
  if (card) {
    const { borderBottomLeftRadius, borderBottomRightRadius } = getComputedStyle(card)
    return [parseFloat(borderBottomLeftRadius) || 0, parseFloat(borderBottomRightRadius) || 0]
  }
  const panes = document.querySelector('main') ?? document.documentElement
  const round = parseFloat(getComputedStyle(panes).getPropertyValue('--card-radius')) || 0
  return [round, round]
}
export function readOpening(said: unknown): Opening | null {
  if (!isRecord(said) || !isString(said.tab) || !isString(said.url)) return null
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
  watching: object | null = null
  stirred = true
  placings = 0
  showings = 0
  stowed = false
  stowing: ReturnType<typeof setTimeout> | undefined
  blank = false
  afterBlank: Wanted | null = null
  blanking: ReturnType<typeof setTimeout> | undefined
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
export function inSight(page: Page): boolean {
  return page.onScreen
}
class Pages {
  private readonly held = new Map<string, Page>()
  private readonly gone = new Set<string>()
  private readonly goingTo = new WeakMap<Page, string>()
  private readonly movedWhileTyping = new WeakSet<Page>()
  private listening: Promise<void> | null = null
  readonly arriving = new Set<{ pane: Rect; done: Promise<void> }>()
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
  show(tabId: string, url: string, pane: Rect, visible = true, over: Over = NOTHING): Promise<void> {
    const done = this.showing(tabId, url, pane, visible, over)
    if (!visible || !this.held.get(tabId)?.live) return done
    const one = { pane, done }
    this.arriving.add(one)
    void done.finally(() => this.arriving.delete(one))
    return done
  }
  private async showing(tabId: string, url: string, pane: Rect, visible: boolean, over: Over): Promise<void> {
    this.gone.delete(tabId)
    const page = this.of(tabId)
    this.wake(page)
    page.url ??= url
    page.onScreen = true
    const turn = ++page.showings
    if (!isDesktop) {
      page.live = true
      return
    }
    await this.listen()
    if (page.crashed || page.showings !== turn) return
    if (page.live) {
      await this.thaw(tabId)
      if (page.showings !== turn) return
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
    const goingTo = this.goingTo.get(page)
    this.goingTo.delete(page)
    if (goingTo && handed) void this.go(tabId, goingTo, page.upgrade)
    const wanted = page.wanted
    page.wanted = null
    if (!wanted) return
    if (handed) await this.place(tabId, wanted.pane, wanted.visible, wanted.covering, wanted.over)
    else await this.build(tabId, page, wanted.pane, wanted.visible, wanted.over)
  }
  async build(tabId: string, page: Page, pane: Rect, visible: boolean, over: Over = NOTHING): Promise<void> {
    page.opening = true
    if (!visible) page.wanted = { pane, visible, covering: true, over }
    const kept = placeOf(page.path)
    const here = kept?.url === page.url ? kept : null
    const place = here ? { x: here.x, y: here.y } : null
    const trail = here?.trail ?? []
    page.pane = pane
    const tried = page.url
    const forOwn = page.own
    this.goingTo.delete(page)
    try {
      const store = page.inPrivate ? null : await (await stores()).store(forOwn)
      const pass = (await import('../../gates/src/api')).passOn()
      page.blank = true
      clearTimeout(page.blanking)
      page.blanking = undefined
      const said = await invoke<boolean | 'hollows' | undefined>('web_open', {
        tab: tabId,
        url: page.url,
        pane: awayFrom(pane).pane,
        ground: (await still()).groundNow(),
        revived: { place, trail, at: kept?.at ?? Math.max(0, trail.length - 1) },
        profile: { store, private: page.inPrivate, pass },
      })
      heard(page, said)
      page.live = true
      page.openable = true
      page.frozen = false
      page.rebuilding = false
      page.store = store
      page.shown = false
      if (stillBlank(page)) {
        page.afterBlank = visible ? { pane, visible, covering: false, over } : null
        page.blanking ??= setTimeout(() => this.painted(tabId, page), BLANK_WAITS)
      } else if (visible) page.wanted ??= { pane, visible, covering: false, over }
      void this.bound()
    } catch (error) {
      if (error === NOT_ANSWERING) {
        setTimeout(() => {
          const asking = this.held.get(tabId) === page && !page.live && !page.opening
          if (asking && page.onScreen) void this.build(tabId, page, page.pane ?? pane, visible, over)
        }, ASK_AGAIN)
        return
      }
      await shut(tabId, false)
      if (page.rebuilding) {
        page.rebuilding = false
        page.crashed = true
      } else if (page.url === tried) page.openable = false
    } finally {
      page.opening = false
    }
    const goingTo = this.goingTo.get(page)
    this.goingTo.delete(page)
    if (goingTo) page.url = goingTo
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
      await shut(tabId, false)
      return
    }
    if (page.own !== forOwn && !page.inPrivate) void this.rehouse(tabId, page.own)
    if (goingTo && goingTo !== tried) void this.go(tabId, goingTo, page.upgrade)
    if (!wanted) return
    if (wanted.visible) await this.place(tabId, wanted.pane, true, false, wanted.over)
    else if (wanted.covering)
      await this.place(tabId, wanted.pane, false, cutsOut(page.layering, wanted.over.cut), wanted.over)
    else this.hide(tabId, wanted.pane)
  }
  async place(tabId: string, pane: Rect, visible: boolean, covering = false, over: Over = NOTHING): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page) return
    if (page.opening) {
      page.wanted = { pane, visible, covering, over }
      return
    }
    if (!page.live && visible) return
    const turn = ++page.placings
    clearTimeout(page.stowing)
    if (page.blank && page.live) {
      page.afterBlank = { pane, visible, covering, over }
      return
    }
    if (covering && page.live && cutsOut(page.layering, over.cut)) {
      await this.cover(tabId, page, pane, over)
      if (over.cut?.all) void still().then((one) => one.keepFresh(this, tabId, page, () => page.placings === turn))
      return
    }
    if (covering) await this.shoot(tabId)
    if (page.placings !== turn) return
    if (covering && goesAway(page.layering) && (page.shown || page.stowed)) {
      if (!page.stowed) await this.put(tabId, page, awayFrom(pane))
      if (over.cut?.all) {
        page.stowing = setTimeout(() => void this.stow(tabId, page, pane, turn), COVER_HIDES)
        void still().then((one) => one.keepFresh(this, tabId, page, () => page.placings === turn && !page.stowed))
      }
      return
    }
    if (visible && page.stowed) {
      page.stowed = false
      await this.put(tabId, page, awayFrom(pane))
      await new Promise<void>((go) => setTimeout(go, DRAWN_AWAY))
      if (page.placings !== turn) return
    }
    await this.put(tabId, page, {
      pane,
      visible,
      frame: over.frame,
      cut: null,
      corner: over.corner,
    })
  }
  painted(tabId: string, page: Page): void {
    if (!page.blank) return
    page.blank = false
    clearTimeout(page.blanking)
    page.blanking = undefined
    if (page.opening) return
    const after = page.afterBlank
    page.afterBlank = null
    if (after && this.held.get(tabId) === page) {
      void this.place(tabId, after.pane, after.visible, after.covering, after.over)
    }
  }
  private async stow(tabId: string, page: Page, pane: Rect, turn: number): Promise<void> {
    if (page.placings !== turn) return
    page.stowed = true
    await this.put(tabId, page, { pane, visible: false, frame: null, cut: null })
  }
  private async cover(tabId: string, page: Page, pane: Rect, over: Over): Promise<void> {
    if (!over.cut) return
    const placed = this.put(tabId, page, {
      pane,
      visible: true,
      frame: over.frame,
      cut: over.cut,
      corner: over.corner,
    })
    if (over.cut.all) void this.shoot(tabId)
    await placed
  }
  async put(tabId: string, page: Page, one: Placement): Promise<void> {
    page.placing ??= new Latest((sent) => this.send(tabId, page, sent))
    await page.placing.put(one).catch(() => undefined)
  }
  private async send(tabId: string, page: Page, one: Placement): Promise<void> {
    if (one.visible && !one.away && !page.onScreen && !page.lent) return
    page.sent = one
    try {
      const said = await invoke<boolean | 'hollows' | undefined>('web_place', {
        tab: tabId,
        pane: one.pane,
        visible: one.visible,
        frame: one.frame,
        cut: one.cut,
        corner: one.corner ?? cardCorner(),
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
    if (one.visible && (page.pane?.width !== one.pane.width || page.pane.height !== one.pane.height)) {
      page.shot = null
    }
    page.pane = one.pane
    page.shown = one.visible
  }
  get cuts(): boolean {
    return layering !== 'hide'
  }
  still = $state(false)
  holdStill(): Promise<void> | null {
    this.still = true
    const shown = this.each().filter(([, page]) => this.heldWhere(page) !== null)
    if (shown.length === 0) return null
    return Promise.all(shown.map(([tabId, page]) => this.holdOne(tabId, page))).then(() => undefined)
  }
  private heldWhere(page: Page): Placement | null {
    if (!isDesktop || !page.live) return null
    return page.heldAt ?? (page.shown && page.sent?.visible && !page.sent.away ? page.sent : null)
  }
  private async holdOne(tabId: string, page: Page): Promise<void> {
    const at = this.heldWhere(page)
    if (!at) return
    const fresh = page.heldAt === null
    if (fresh) {
      if (!this.still || !page.onScreen) return
      page.heldAt = at
    }
    await this.put(tabId, page, goesAway(page.layering) ? awayFrom(at.pane) : { ...at, cut: WHOLE })
    if (fresh) void this.shoot(tabId, true)
  }
  async letGo(): Promise<void> {
    this.still = false
    await (await still()).letGo(this)
  }
  hide(tabId: string, pane: Rect) {
    const page = this.held.get(tabId)
    if (!page) return
    page.onScreen = false
    const turn = ++page.showings
    page.placings++
    page.heldAt = null
    page.looked = Date.now()
    if (isDesktop && page.live && page.lent) void import('./lending').then((one) => one.aside(tabId, page, pane))
    else
      void Promise.resolve()
        .then(() => (this.arriving.size ? still().then((one) => one.arrived(this, pane)) : undefined))
        .then(() => (page.showings === turn ? this.place(tabId, pane, false) : undefined))
    if (!isDesktop) return
    void this.look(tabId).then(() => this.rest(tabId))
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
    if (this.held.get(tabId)?.live !== true || (hidden && page.onScreen)) return
    page.live = false
    page.frozen = false
    page.loading = false
    page.playing = false
    clearTimeout(page.resting)
    await shut(tabId, true)
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
    await shut(tabId, true)
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
    return Promise.race([
      invoke<Looked>('web_look', { tab: tabId }),
      new Promise<null>((go) => setTimeout(() => go(null), LOOK_WAITS)),
    ]).catch(() => null)
  }
  async stepAddress(tabId: string, by: -1 | 1): Promise<string | null> {
    const said = await this.whereIs(tabId)
    return said?.trail[said.at + by] ?? null
  }
  async shoot(tabId: string, quick = false): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live || !page.shown) return
    if (page.shot && Date.now() - page.shotAt < SHOT_KEEPS) return
    await this.retake(tabId, page, quick)
  }
  async retake(tabId: string, page: Page, quick = false): Promise<void> {
    if (page.shooting) return page.shooting
    const { url, pane, shotAt, shot } = page
    const asked = invoke<string | null>('web_shot', quick ? { tab: tabId, quick } : { tab: tabId })
    asked.catch(() => undefined)
    const taking = still().then((one) => one.photographed(page, asked, url, pane, shotAt, shot !== null))
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
  private wake(page: Page) {
    clearTimeout(page.resting)
    page.resting = undefined
    page.looked = Date.now()
  }
  private async bound(): Promise<void> {
    ;(await sleeping()).bound(this)
  }
  typing(tabId: string, on: boolean) {
    const page = this.held.get(tabId)
    if (!page) return
    page.typing = on
    if (on || !this.movedWhileTyping.has(page)) return
    this.movedWhileTyping.delete(page)
    if (page.at) page.url = page.at
  }
  async go(tabId: string, url: string, upgrade: Upgrade | null = null): Promise<void> {
    const page = this.of(tabId)
    if (!isWebAddress(url)) return
    this.movedWhileTyping.delete(page)
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
    if (page.opening) this.goingTo.set(page, url)
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
      await shut(tabId, true)
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
  async read(tabId: string, selection: boolean): Promise<Clipped | null> {
    if (!isDesktop || !this.held.get(tabId)?.live) return null
    return invoke<Clipped>('web_clip', { tab: tabId, selection }).catch(() => null)
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
      leftPrivate(this.anyPrivate())
      if (isDesktop) void shut(tabId, false)
      return
    }
    void this.closing(tabId)
  }
  private async closing(tabId: string): Promise<void> {
    await this.look(tabId)
    this.held.delete(tabId)
    leftPrivate(this.anyPrivate())
    await shut(tabId, false)
  }
  keepOnly(ids: readonly string[]) {
    const kept = new Set(ids)
    for (const tabId of [...this.held.keys()]) if (!kept.has(tabId)) this.forget(tabId)
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
    const { workspace } = await import('../../workspace/src/api')
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
    if (!isDesktop || typeof window === 'undefined') return Promise.resolve()
    this.listening ??= (async () => {
      const { hearHere: listen } = await import('../../windows/src/api')
      await listen('orden://web-open', (event) => {
        const said = readOpening(event.payload)
        if (said && this.held.has(said.tab)) void this.openAsked(said)
      })
      await listen('orden://web-chosen', (event) => {
        const tab = readChosen(event.payload)
        if (tab !== null && this.held.has(tab)) void chooseTab(tab)
      })
      await listen('orden://web-blocked', (event) => {
        const said = readOpening(event.payload)
        const page = said && this.held.get(said.tab)
        if (said && page) page.blocked = said.url
      })
      await listen('orden://web-drew', (event) => {
        const said = event.payload
        if (!isRecord(said) || !isString(said.tab)) return
        const picture = isString(said.picture) ? said.picture : null
        void still().then((one) => one.drew(this, said.tab as string, picture))
      })
      await listen('orden://web-painted', (event) => {
        const tab = isRecord(event.payload) && isString(event.payload.tab) ? event.payload.tab : null
        const page = tab === null ? undefined : this.held.get(tab)
        if (tab !== null && page) this.painted(tab, page)
      })
      ;(await still()).watchGround()
      const { hearAsks } = await import('./asked.svelte')
      await hearAsks(listen)
      const { pointerMoved } = await import('./pointed')
      await listen('orden://web-pointer', (event) => {
        pointerMoved(event.payload, (tab) => {
          const page = this.held.get(tab)
          if (page) page.stirred = true
          return page?.shown ? page.pane : null
        })
      })
      const { readPressed } = await import('./keys')
      await listen('orden://web-key', (event) => {
        const one = readPressed(event.payload)
        if (!one) return
        for (const [, page] of this.held) if (page.shown) page.stirred = true
        replay(one)
      })
      const { downloads, readDownload } = await import('./downloads.svelte')
      await listen('orden://web-download', (event) => {
        const said = readDownload(event.payload)
        if (said && downloads.heard(said)) void this.downloaded(said.tab)
      })
      void downloads.load()
      await listen('orden://web-icon', (event) => {
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
          void Promise.all([import('./favicons'), import('../../marks/src/api')]).then(([one, files]) =>
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
      await listen('orden://web-tab', (event) => {
        const said = readMoved(event.payload)
        if (!said) return
        const page = this.held.get(said.tab)
        if (!page) return
        page.stirred = true
        if (said.url && page.blank) {
          clearTimeout(page.blanking)
          page.blanking = setTimeout(() => this.painted(said.tab, page), AFTER_COMMIT)
        }
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
        else if (said.url && said.url !== page.url) this.movedWhileTyping.add(page)
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
function carried(step: (carry: typeof import('./carry-in')) => void): void {
  if (isDesktop) void import('./carry-in').then(step)
}
providePort('web.pages', {
  get cuts() {
    return pages.cuts
  },
  of: (tab) => pages.of(tab),
  tabs: () => pages.each().map(([tab]) => tab),
  addressOf: (tab) => pages.addressOf(tab),
  loadingOf: (tab) => pages.loadingOf(tab),
  lentOf: (tab) => pages.lentOf(tab),
  losing: (tab) => pages.losing(tab),
  reload: (tab) => pages.step(tab, 'reload'),
  park: (tab, hidden) => pages.park(tab, hidden),
  copyPage: (from, to, url, inPrivate) => {
    const page = pages.of(to)
    page.url = url
    page.title = pages.of(from).title
    page.inPrivate = inPrivate
  },
  named: (tab, url, title) => {
    const page = pages.of(tab)
    page.url = url
    page.title = title
  },
  privately: (tab, inPrivate) => {
    pages.of(tab).inPrivate = inPrivate
  },
  typedInto: (tab) => pages.typedInto(tab),
  step: (tab, way) => pages.step(tab, way),
  stepAddress: (tab, by) => pages.stepAddress(tab, by),
  freeze: (tab) => pages.freeze(tab),
  thaw: (tab) => pages.thaw(tab),
  forget: (tab) => pages.forget(tab),
  keepOnly: (tabs) => pages.keepOnly(tabs),
  shoot: (tab) => pages.shoot(tab),
  clip: (tab, selection) => pages.read(tab, selection),
  faviconOf: (url) => favicons.of(url),
  iconOf: (tab) => pages.iconOf(tab),
  holdStill: () => pages.holdStill(),
  letGo: () => pages.letGo(),
  carryIn: (paths) => carried((carry) => carry.carryToPages(paths)),
  carriedIn: () => carried((carry) => carry.carriedToPages()),
  bringHistory: async (rows) => {
    const [visited, webData] = await Promise.all([history(), stores()])
    visited.brought(webData.history(), rows)
  },
  takeEngine: async (engine) => {
    const { CUSTOM, searchEngine } = await import('./search-engine.svelte')
    const same =
      'id' in engine
        ? searchEngine.id === engine.id
        : searchEngine.id === CUSTOM && searchEngine.custom === engine.custom
    if (same) return 'same'
    if (searchEngine.chosen) return 'kept'
    if ('id' in engine) searchEngine.choose(engine.id)
    else searchEngine.setCustom(engine.custom)
    return 'taken'
  },
  searchHome: async () => (await import('./search-engine.svelte')).searchEngine.home,
  replayKey: (key) => {
    replay(key)
  },
  articleOf: async (page) => {
    const { articleOf } = await import('./note')
    return (await articleOf(page)).html
  },
  clipNote: async (page, on) => {
    const { clipNote } = await import('./note')
    return clipNote(page, on)
  },
})
export const MARKS = 'orden:favicons'
export const MARK = 'orden:favicon:'
const stillBlank = (page: Page): boolean => page.blank
export function drawable(picture: string): boolean {
  return picture.length <= 22 * 1024 && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(picture)
}
export type Seen = [picture: string, used: number]
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
