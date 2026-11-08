import { tick } from 'svelte'
import { focusEditor } from '../focus'
import { identifier } from '../identifier'
import { log } from '../log'
import { without } from '../records'
import { forget, isRecord, stored } from '../stored'
import { spaceSound } from '../surfaces.svelte'
import { invoke, isDesktop } from '../tauri'
import { IN_A_PAGE } from '../trap'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { type Frame, pane, paneIn, panesIn } from './pane-tree'
import {
  focusIn,
  GLOBAL,
  readSets,
  type SetDraft,
  type SetsDraft,
  setKey,
  sharedGoesTo,
  tidied,
} from './sets'
import { TABS_KEY, tabSets } from './spaces'
import { TAB_KINDS } from './tab-kinds'

interface Aside {
  frame: Frame
  focused: string
  fills: string | null
  preview: string | null
  held: string | null
  inPage: boolean
}

const hiddenTabs = () => import('./hidden-tabs.svelte').then((one) => one.hiddenTabs)

function inPage(): boolean {
  const root = typeof document === 'undefined' ? null : (document.documentElement as Element | null)
  return root?.hasAttribute(IN_A_PAGE) ?? false
}

class Sets {
  private aside = $state.raw<Record<string, Aside>>({})
  private drafted: Record<string, SetDraft> = {}
  private building = new Map<string, Promise<void>>()
  on: string
  private going: Promise<void> = Promise.resolve()

  constructor() {
    const read = readSets(workspace.setsRead)
    const on = read?.on ?? GLOBAL
    this.on = on === GLOBAL ? setKey(workspace.activeSpaceId) : on
    this.drafted = read?.aside ?? {}
    this.handOver()
    workspace.setsWritten = () => this.written()
    tabSets.fetched = true
    void spaceSound.ask()
  }

  private handOver() {
    const shared = this.drafted[GLOBAL]
    const kept = stored(TABS_KEY)
    forget(TABS_KEY)
    if (!shared || workspace.activeSpaceId === null) return

    const owned = new Set(
      isRecord(kept) ? Object.keys(kept).filter((one) => kept[one] === 'space') : [],
    )
    const to = sharedGoesTo(
      workspace.spaces.map((one) => one.id),
      owned,
      (space) => space === this.on || space in this.drafted,
    )
    if (to === null) return
    this.drafted = { ...without(this.drafted, GLOBAL), [to]: shared }
  }

  async wake(): Promise<void> {
    for (const key of Object.keys(this.drafted)) {
      await this.built(key).catch((error: unknown) => {
        log('warn', `sets: ${key} was not built - ${String(error)}`)
      })
    }
    if (this.on !== GLOBAL && this.aside[GLOBAL]) {
      this.carry(this.tabsOf(GLOBAL), workspace.panes.focusedId)
      this.aside = without(this.aside, GLOBAL)
      workspace.persist()
    }
  }

  async toSpace(id: string): Promise<void> {
    const ws = workspace
    this.going = this.going.catch(() => undefined).then(() => this.swap(id))
    await this.going

    ws.clearSelection()
    await ws.loadTree()
    ws.persist()
  }

  private async swap(id: string): Promise<void> {
    const ws = workspace
    const to = setKey(id)
    if (to === this.on) {
      ws.activeSpaceId = id
      return
    }

    await this.built(to)
    if (this.on === GLOBAL && !this.aside[to]) {
      this.on = to
      ws.activeSpaceId = id
      return
    }
    const left = this.on
    const coming = this.aside[to]
    this.putAside(left)
    this.bringIn(to, coming)
    ws.activeSpaceId = id

    void this.settle(left, to, coming)
  }

  private putAside(key: string) {
    const ws = workspace
    this.aside = {
      ...this.aside,
      [key]: {
        frame: ws.panes.frame,
        focused: ws.panes.focusedId,
        fills: ws.panes.fills,
        preview: ws.previewTabId,
        held: ws.heldTabId,
        inPage: inPage(),
      },
    }
  }

  private bringIn(key: string, set: Aside | undefined) {
    const ws = workspace
    this.aside = without(this.aside, key)
    this.on = key

    const frame = set ? this.tidy(set.frame) : pane(identifier())
    ws.panes.swapping = true
    ws.panes.restore(frame, set ? focusIn(frame, set.focused) : frame.id)
    ws.panes.fills = set?.fills && paneIn(frame, set.fills) ? set.fills : null
    ws.previewTabId = set?.preview ?? null
    ws.heldTabId = set?.held ?? null
  }

  private async settle(left: string, to: string, coming: Aside | undefined) {
    setTimeout(() => (workspace.panes.swapping = false))
    await tick()

    const front = workspace.active
    if (coming?.inPage && front?.kind === 'web') {
      void invoke('keyboard_back', { tab: front.id }).catch(() => undefined)
    } else if (coming && typeof document !== 'undefined' && front?.kind === 'note') {
      focusEditor()
    }

    if (!isDesktop) return
    const hidden = await hiddenTabs()
    hidden.came(this.tabsOf(to))
    await hidden.left(this.tabsOf(left))
  }

  tabsOf(key: string): Tab[] {
    const set = this.aside[key]
    if (key === this.on) return workspace.tabs.filter((tab) => workspace.panes.at(tab.paneId))
    if (!set) return []

    const panes = new Set(panesIn(set.frame).map((one) => one.id))
    return workspace.tabs.filter((tab) => panes.has(tab.paneId))
  }

  frameOf(key: string): Frame | null {
    if (key === this.on) return workspace.panes.frame
    return this.aside[key]?.frame ?? null
  }

  private setOf(tab: Tab): string | null {
    for (const [key, set] of Object.entries(this.aside)) {
      if (paneIn(set.frame, tab.paneId)) return key
    }
    return null
  }

  private tidy(frame: Frame): Frame {
    return tidied(
      frame,
      (paneId) => workspace.heldIn(paneId).map((tab) => tab.id),
      (strip) => workspace.panes.successorOf(strip),
    )
  }

  async reveal(id: string): Promise<void> {
    const ws = workspace
    const tab = ws.tabs.find((one) => one.id === id)
    if (!tab) return

    const key = this.setOf(tab)
    const space = key !== null && ws.spaces.some((one) => one.id === key) ? key : null

    if (space !== null) await this.toSpace(space)
    if (!ws.panes.at(tab.paneId)) this.carry([tab], ws.panes.focusedId)
    ws.activeTabId = id
  }

  private carry(tabs: readonly Tab[], paneId: string) {
    const ws = workspace
    for (const tab of tabs) tab.paneId = paneId
    ws.tabs = [...ws.tabs.filter((tab) => !tabs.includes(tab)), ...tabs]
  }

  async adopt(tabs: readonly Tab[], space: string): Promise<void> {
    const ws = workspace
    const key = setKey(space)
    await this.built(key)

    const there = new Set(
      this.tabsOf(key)
        .filter((tab) => TAB_KINDS[tab.kind].single)
        .map((tab) => tab.kind),
    )
    const coming = tabs.filter((tab) => this.keyOf(tab) !== key)
    const twice = coming.filter((tab) => there.has(tab.kind))
    if (twice.length)
      ws.closeEach(
        twice.map((tab) => tab.id),
        false,
      )
    const moving = coming.filter((tab) => !twice.includes(tab))
    if (!moving.length) return
    const shown = moving.filter((tab) => ws.panes.at(tab.paneId))
    const left = new Set(moving.map((tab) => this.keyOf(tab)))

    if (ws.previewTabId !== null && moving.some((tab) => tab.id === ws.previewTabId)) {
      ws.previewTabId = null
    }
    if (ws.heldTabId !== null && moving.some((tab) => tab.id === ws.heldTabId)) {
      ws.heldTabId = null
    }

    const set = this.aside[key]
    if (key === this.on) {
      this.carry(moving, ws.panes.focusedId)
    } else if (set) {
      const into = paneIn(set.frame, set.focused) ?? panesIn(set.frame)[0]
      if (into) {
        this.carry(moving, into.id)
        workspace.panes.arrived(moving.map((tab) => tab.id))
        into.activeTabId = moving.at(-1)?.id ?? into.activeTabId
      }
    } else {
      this.aside = { ...this.aside, [key]: this.fresh(moving) }
    }

    for (const one of left) {
      if (one === this.on) this.retidyOn()
      else if (one !== null) this.retidy(one)
    }
    ws.persist()

    if (!isDesktop || !shown.length) return
    const hidden = await hiddenTabs()
    await hidden.left(shown.filter((tab) => !ws.panes.at(tab.paneId)))
  }

  private keyOf(tab: Tab): string | null {
    return workspace.panes.at(tab.paneId) ? this.on : this.setOf(tab)
  }

  private retidyOn() {
    const ws = workspace
    const frame = this.tidy(ws.panes.frame)
    ws.panes.restore(frame, ws.panes.focusedId)
    if (ws.panes.fills !== null && !paneIn(frame, ws.panes.fills)) ws.panes.fills = null
  }

  private fresh(tabs: readonly Tab[]): Aside {
    const made = pane(identifier())
    this.carry(tabs, made.id)
    made.activeTabId = workspace.panes.successorOf(tabs.map((tab) => tab.id))
    return {
      frame: made,
      focused: made.id,
      fills: null,
      preview: null,
      held: null,
      inPage: false,
    }
  }

  private retidy(key: string) {
    const set = this.aside[key]
    if (!set) return
    const frame = this.tidy(set.frame)
    this.aside = { ...this.aside, [key]: { ...set, frame, focused: focusIn(frame, set.focused) } }
  }

  private built(key: string): Promise<void> {
    const under = this.building.get(key)
    if (under) return under
    const draft = this.drafted[key]
    if (!draft || key === this.on) return Promise.resolve()

    const building = workspace.opened
      .arranging(async () => {
        const { frame, made } = await workspace.built(draft.layout)
        if (key === this.on) return
        this.drafted = without(this.drafted, key)
        if (!made.length) return
        workspace.tabs = [...workspace.tabs, ...made]
        this.aside = {
          ...this.aside,
          [key]: {
            frame,
            focused: focusIn(frame, draft.layout.focused),
            fills: null,
            preview: null,
            held: null,
            inPage: false,
          },
        }
      })
      .finally(() => this.building.delete(key))
    this.building.set(key, building)
    return building
  }

  private written(): SetsDraft | undefined {
    const aside: Record<string, SetDraft> = { ...this.drafted }
    for (const [key, set] of Object.entries(this.aside)) {
      if (!this.tabsOf(key).length) continue
      aside[key] = {
        layout: workspace.layout(set.frame, set.focused),
        right: workspace.rightPanel,
      }
    }
    return this.on === GLOBAL && !Object.keys(aside).length ? undefined : { on: this.on, aside }
  }

  readonly playing = $derived.by((): string[] => {
    const out: string[] = []
    for (const [key, set] of Object.entries(this.aside)) {
      const panes = panesIn(set.frame).map((one) => one.id)
      if (key === GLOBAL || out.includes(key)) continue
      const sounds = workspace.tabs.some(
        (tab) => tab.kind === 'web' && panes.includes(tab.paneId) && pages.of(tab.id).playing,
      )
      if (sounds) out.push(key)
    }
    return out
  })

  async gone(space: string): Promise<void> {
    this.drafted = without(this.drafted, space)
    await this.building.get(space)?.catch(() => undefined)
    if (space === this.on) {
      this.on = GLOBAL
      return
    }
    workspace.closeEach(this.tabsOf(space).map((tab) => tab.id))
    this.aside = without(this.aside, space)
  }
}

export const sets = new Sets()
void sets.wake()
