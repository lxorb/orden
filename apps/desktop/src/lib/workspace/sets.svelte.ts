/** The spaces' own sets of tabs, carried out on the workspace: a switch putting one set
 *  aside and bringing another in, a tab of a set out of sight shown, a tab moved to
 *  another space, and the sets written with the session and built again after a restart. What each of
 *  those decides is sets.ts; this is the store that does it.
 *
 *  **A set out of sight is a frame put aside.** Every tab of every set stays in the
 *  workspace's one strip, so everything that holds across the tabs holds across the sets
 *  without being told: one document per file, one tab per web note, a page and a shell
 *  running for as long as their tab is open, a file renamed or deleted under a tab nobody
 *  can see. A tab is on screen when its pane is in the frame on screen; the frames of
 *  the other sets are kept here with the rest of what belongs to them - which pane has
 *  the focus and which fills the window, both sides' panels, the preview, the tab the
 *  panels are held on, and whether the keyboard was in a page.
 *
 *  Every space keeps its own tabs (#674), so this is fetched by the first switch of
 *  space or move of a tab to another, and by a launch whose session holds sets, at its
 *  last turn. */

import { tick, untrack } from 'svelte'
import { focusEditor } from '../focus'
import { identifier } from '../identifier'
import { without } from '../records'
import { forget, isRecord, stored } from '../stored'
import { spaceSound } from '../surfaces.svelte'
import { invoke, isDesktop } from '../tauri'
import { IN_A_PAGE } from '../trap'
import { pages } from '../web-tab/pages.svelte'
import { type Panel, type Tab, workspace } from '../workspace.svelte'
import { type Frame, pane, paneIn, panesIn } from './pane-tree'
import { byPin } from './pinning'
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

/** A set out of sight: everything about the window that is the set's, but its tabs. */
interface Aside {
  frame: Frame
  focused: string
  fills: string | null
  panel: Panel | null
  rightPanel: Panel | null
  preview: string | null
  held: string | null
  /** Whether the keyboard was in a page as the set was left, rather than in the app. */
  inPage: boolean
}

/** The Hidden tabs answer and what it does, fetched with the first set that hides a
 *  page; see hidden-tabs.svelte.ts. */
const hiddenTabs = () => import('./hidden-tabs.svelte').then((one) => one.hiddenTabs)

/** Whether the keyboard is in a page rather than in the app; no page where there is no
 *  document to say, which every switch made outside a window is (#674 sends them all
 *  here). */
function inPage(): boolean {
  const root = typeof document === 'undefined' ? null : (document.documentElement as Element | null)
  return root?.hasAttribute(IN_A_PAGE) ?? false
}

class Sets {
  /** The sets out of sight, by key. Raw: replaced whole on every change. */
  private aside = $state.raw<Record<string, Aside>>({})
  /** Sets a session named that have not been built back yet, by key. */
  private drafted: Record<string, SetDraft> = {}
  /** Builds under way, so a switch and the launch's build share one. */
  private building = new Map<string, Promise<void>>()
  /** The set on screen. Kept rather than worked out from the space: a window in no
   *  space shows the window's own, and the tabs on screen are whichever set they were. */
  on: string
  /** Switches one at a time: the second waits for the first's swap. */
  private going: Promise<void> = Promise.resolve()

  constructor() {
    const read = readSets(workspace.setsRead)
    // A window that showed the shared set of older builds shows its space's own now:
    // the tabs on screen are that space's, which is what the reader was looking at.
    const on = read?.on ?? GLOBAL
    this.on = on === GLOBAL ? setKey(workspace.activeSpaceId) : on
    this.drafted = read?.aside ?? {}
    this.handOver()
    workspace.setsWritten = () => this.written()
    tabSets.fetched = true
    void spaceSound.ask()
  }

  /** The set every Global space shared before #674, out of sight, given to a space of its
   *  own, once: the first that shared it and has none yet. Where every space has one, it
   *  joins the set on screen at the launch's build (`wake`). The record of which spaces
   *  kept their own goes with it. */
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

  /** The sets the session named, built in the background, and the shared set no space
   *  could take put into the set on screen, so none of its tabs is lost. */
  async wake(): Promise<void> {
    for (const key of Object.keys(this.drafted)) await this.built(key)
    if (this.on !== GLOBAL && this.aside[GLOBAL]) {
      this.carry(this.tabsOf(GLOBAL), workspace.panes.focusedId)
      this.aside = without(this.aside, GLOBAL)
      workspace.persist()
    }
  }

  /** The switch to a space, wherever it was asked. The set on screen is put aside and the
   *  space's own brought in, in the one step that also changes the space, so the first
   *  frame drawn after it is the new set whole; then the tree is read, as any switch reads
   *  it. */
  async toSpace(id: string, shown: boolean): Promise<void> {
    const ws = workspace
    this.going = this.going.catch(() => undefined).then(() => this.swap(id))
    await this.going

    if (shown) ws.panel ??= 'tree'
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
    // A window in no space that comes into one with no set yet: what is open becomes
    // that space's, rather than put aside where no space would show it again.
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

  /** The set on screen, put aside under its key. */
  private putAside(key: string) {
    const ws = workspace
    this.aside = {
      ...this.aside,
      [key]: {
        frame: ws.panes.frame,
        focused: ws.panes.focusedId,
        fills: ws.panes.fills,
        panel: ws.panel,
        rightPanel: ws.rightPanel,
        preview: ws.previewTabId,
        held: ws.heldTabId,
        inPage: inPage(),
      },
    }
  }

  /** A set brought on screen: its frame, put right for whatever happened to its tabs out
   *  of sight, or one empty pane for a space that has never had a set. The sides of a set
   *  never seen are left as they are. */
  private bringIn(key: string, set: Aside | undefined) {
    const ws = workspace
    this.aside = without(this.aside, key)
    this.on = key

    const frame = set ? this.tidy(set.frame) : pane(identifier())
    ws.panes.swapping = true
    ws.panes.restore(frame, set ? focusIn(frame, set.focused) : frame.id)
    ws.panes.fills = set?.fills && paneIn(frame, set.fills) ? set.fills : null
    if (set) {
      ws.panel = set.panel
      ws.rightPanel = set.rightPanel
    }
    ws.previewTabId = set?.preview ?? null
    ws.heldTabId = set?.held ?? null
  }

  /** After the swap: the strip's arrival is over by the next frame, the keyboard goes
   *  where the new set had it, and the Hidden tabs answer is given to the set that left. */
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

  /** The tabs of a set: on screen, or in a frame put aside. */
  tabsOf(key: string): Tab[] {
    const set = this.aside[key]
    if (key === this.on) return workspace.tabs.filter((tab) => workspace.panes.at(tab.paneId))
    if (!set) return []

    const panes = new Set(panesIn(set.frame).map((one) => one.id))
    return workspace.tabs.filter((tab) => panes.has(tab.paneId))
  }

  /** Which set out of sight a tab is in, or null. */
  private setOf(tab: Tab): string | null {
    for (const [key, set] of Object.entries(this.aside)) {
      if (paneIn(set.frame, tab.paneId)) return key
    }
    return null
  }

  /** A frame with its panes put right for what happened to its tabs; see `tidied`. */
  private tidy(frame: Frame): Frame {
    return tidied(
      frame,
      // Every tab a pane holds: one holding only an essential is a pane still in use.
      (paneId) => workspace.heldIn(paneId).map((tab) => tab.id),
      (strip) => workspace.panes.lastOf(strip),
    )
  }

  /** A tab of a set out of sight, brought to the front: its space comes first, the way
   *  Arc's command bar goes to the space a tab is in and Chrome's Switch to tab to its
   *  window. One no space shows - a space's set gone with it, or the window's own set
   *  of before it had a space - comes into the set on screen instead. */
  async reveal(id: string): Promise<void> {
    const ws = workspace
    const tab = ws.tabs.find((one) => one.id === id)
    if (!tab) return

    const key = this.setOf(tab)
    const space = key !== null && ws.spaces.some((one) => one.id === key) ? key : null

    if (space !== null) await this.toSpace(space, false)
    // Still out of sight - a set no space shows - it comes here rather than nowhere.
    if (!ws.panes.at(tab.paneId)) this.carry([tab], ws.panes.focusedId)
    ws.activeTabId = id
  }

  /** Tabs moved to the end of a pane's strip, the kept ones to the end of the kept run. */
  private carry(tabs: readonly Tab[], paneId: string) {
    const ws = workspace
    for (const tab of tabs) tab.paneId = paneId
    ws.tabs = byPin([...ws.tabs.filter((tab) => !tabs.includes(tab)), ...tabs])
  }

  /** Tabs moved to another space's set. Each tab is the same tab - a shell keeps running and a page keeps its place -
   *  and only the set it is in changes. They go to the end of the strip in front in that
   *  set, the last of them in front, which is where Chrome puts a tab moved to another
   *  window; the set they left falls back to the tab used before, as after a close. What
   *  went out of sight is hidden as a switch hides it. See workspace/space-move.ts. */
  async adopt(tabs: readonly Tab[], space: string): Promise<void> {
    const ws = workspace
    const key = setKey(space)
    await this.built(key)

    const moving = tabs.filter((tab) => this.keyOf(tab) !== key)
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
        into.activeTabId = moving.at(-1)?.id ?? into.activeTabId
      }
    } else {
      this.aside = { ...this.aside, [key]: this.fresh(moving, 'tree') }
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

  /** Which set a tab is in: the one on screen, one put aside, or none. */
  private keyOf(tab: Tab): string | null {
    return workspace.panes.at(tab.paneId) ? this.on : this.setOf(tab)
  }

  /** The set on screen with its frame put right, the full window let go where its pane
   *  went with it. */
  private retidyOn() {
    const ws = workspace
    const frame = this.tidy(ws.panes.frame)
    ws.panes.restore(frame, ws.panes.focusedId)
    if (ws.panes.fills !== null && !paneIn(frame, ws.panes.fills)) ws.panes.fills = null
  }

  /** A set of one pane holding these tabs, the one in front last in front. */
  private fresh(tabs: readonly Tab[], panel: Panel | null): Aside {
    const made = pane(identifier())
    this.carry(tabs, made.id)
    made.activeTabId = workspace.panes.lastOf(tabs.map((tab) => tab.id)) ?? tabs.at(-1)?.id ?? null
    return {
      frame: made,
      focused: made.id,
      fills: null,
      panel,
      rightPanel: null,
      preview: null,
      held: null,
      inPage: false,
    }
  }

  /** A set out of sight with its frame put right. */
  private retidy(key: string) {
    const set = this.aside[key]
    if (!set) return
    const frame = this.tidy(set.frame)
    this.aside = { ...this.aside, [key]: { ...set, frame, focused: focusIn(frame, set.focused) } }
  }

  /** A set the session named, built back through the session's own restore - the same
   *  drafts, documents and frame a launch puts on screen - into a frame put aside. One
   *  build per set, however many ask. */
  private built(key: string): Promise<void> {
    const draft = this.drafted[key]
    if (!draft || key === this.on) return this.building.get(key) ?? Promise.resolve()

    this.drafted = without(this.drafted, key)
    const building = workspace.opened.arranging(async () => {
      const { frame, made } = await workspace.built(draft.layout)
      if (!made.length || key === this.on) return
      workspace.tabs = [...workspace.tabs, ...made]
      this.aside = {
        ...this.aside,
        [key]: {
          frame,
          focused: focusIn(frame, draft.layout.focused),
          fills: null,
          panel: draft.layout.panel,
          rightPanel: draft.right,
          preview: null,
          held: null,
          inPage: false,
        },
      }
    })
    this.building.set(key, building)
    return building
  }

  /** The sets out of sight as the session writes them: the ones built, drafted through the
   *  session's own `layout`, and the ones not built yet as they were read. Nothing at all
   *  where the window is in no space and none is aside. */
  private written(): SetsDraft | undefined {
    const aside: Record<string, SetDraft> = { ...this.drafted }
    for (const [key, set] of Object.entries(this.aside)) {
      if (!this.tabsOf(key).length) continue
      aside[key] = {
        layout: workspace.layout(set.frame, set.focused, set.panel),
        right: set.rightPanel,
      }
    }
    return this.on === GLOBAL && !Object.keys(aside).length ? undefined : { on: this.on, aside }
  }

  /** The spaces with a page playing in a set out of sight, for the sound mark on the
   *  space's row; see SpaceSound.svelte. */
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

  /** A space deleted takes its set with it: its tabs close the way any tab closes, so an
   *  unsaved note's words go to Recently deleted. An empty list is a listing that failed
   *  rather than every space gone, and leaves the sets alone. */
  private gone(spaces: readonly string[]) {
    if (!spaces.length) return

    for (const key of Object.keys(this.aside)) {
      if (key === GLOBAL || spaces.includes(key)) continue
      for (const tab of this.tabsOf(key)) workspace.close(tab.id)
      this.aside = without(this.aside, key)
    }
    for (const key of Object.keys(this.drafted)) {
      if (key !== GLOBAL && !spaces.includes(key)) this.drafted = without(this.drafted, key)
    }
  }

  /** Follows the list of spaces, for `gone`. */
  watch() {
    $effect.root(() => {
      $effect(() => {
        const spaces = workspace.spaces.map((one) => one.id)
        untrack(() => this.gone(spaces))
      })
    })
  }
}

export const sets = new Sets()
sets.watch()
void sets.wake()
