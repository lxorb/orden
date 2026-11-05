/** The pictures of the windows, taken as their tabs leave the screen and kept from run to
 *  run (issue #331; what a picture is, is faces.ts).
 *
 *  A pane's tab in front is photographed the moment another takes its place - another
 *  tab, a space switched, the pane closed - while the pane still shows it: `$effect.pre`
 *  runs before the change reaches the page. A web page's picture is the one the engine
 *  already takes as anything is drawn over it (`shot` in web-tab/pages.svelte.ts). A tab
 *  closed takes its picture with it. What is kept is read back the first time the
 *  overview asks. A private tab has no picture kept, here or on disk: nothing is written
 *  about it (web-tab/private.ts), and its window draws the page's own photograph while
 *  the tab is open.
 *
 *  Started at the launch's last turn on the desktop (start.ts), and fetched by the
 *  overview too. */

import { untrack } from 'svelte'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { TAB_KINDS } from '../workspace/tab-kinds'
import {
  evicted,
  type Face,
  forgetFaces,
  LARGEST,
  readFaces,
  sizeOf,
  upgradeFaces,
  writeFace,
} from './faces'
import { shownBox, snapshotOf } from './mirror'
import { upgradeWindows } from './places.svelte'
import { lastingKeys } from './tab-keys'

/** How long after it was copied a picture is made into markup: after the switch that took
 *  it, or the overview's way in, has been drawn. */
const TAKE_LATER = 700

class Faces {
  /** The pictures of this run's tabs, by tab id. */
  private byId = $state.raw<Record<string, Face>>({})
  /** The name each tab's picture was last written or read under, which a tab whose title
   *  or file has changed since no longer goes by. */
  private written = new Map<string, string>()
  private reading: Promise<void> | null = null

  /** The picture of tab `id`, or null where there is none. */
  of(id: string): Face | null {
    return this.byId[id] ?? null
  }

  /** What was kept in earlier runs, put with the tabs it is of, once; and the oldest let
   *  go where there is more than the store's size. A picture taken this run stays. */
  read(): Promise<void> {
    this.reading ??= readFaces().then((kept) => {
      const names = lastingKeys(workspace.tabs)
      const idOf = new Map([...names].map(([id, name]) => [name, id]))
      const going = new Set(evicted(kept))
      const next = { ...this.byId }
      for (const [name, face] of kept) {
        const id = idOf.get(name)
        if (id && !going.has(name) && !next[id]) {
          next[id] = face
          this.written.set(id, name)
        }
      }
      this.byId = next
      void forgetFaces([...going])
    })
    return this.reading
  }

  /** A picture of what the pane shows now, kept as `tab`'s: copied at once, made into
   *  markup once the moment has passed. */
  take(paneId: string, tab: Tab) {
    // Only what is drawn from a picture keeps one; the rest is drawn from what it holds.
    if (tab.inPrivate || TAB_KINDS[tab.kind].preview !== 'picture') return
    const later = snapshotOf(paneId)
    if (!later) return
    setTimeout(() => {
      if (!workspace.tabs.includes(tab)) return
      const snapshot = later()
      if (snapshot.html.length <= LARGEST)
        this.keep(tab, { ...snapshot, shot: null, at: Date.now() })
    }, TAKE_LATER)
  }

  /** A web page's photograph, kept as its tab's. */
  photographed(tab: Tab, shot: string) {
    if (tab.inPrivate || this.byId[tab.id]?.shot === shot || shot.length > LARGEST) return
    const box = shownBox(tab.paneId)
    const w = box && box.width > 0 ? box.width : 1280
    const h = box && box.height > 0 ? box.height : 800
    this.keep(tab, { html: null, shot, w, h, at: Date.now() })
  }

  private keep(tab: Tab, face: Face) {
    this.byId = { ...this.byId, [tab.id]: face }
    const names = lastingKeys(workspace.tabs)
    const name = names.get(tab.id)
    if (!name || sizeOf(face) <= 0) return
    void writeFace(name, face)
    // The same tab under another name now: what it wrote before is nobody's.
    const before = this.written.get(tab.id)
    this.written.set(tab.id, name)
    if (before && before !== name && ![...names.values()].includes(before)) {
      void forgetFaces([before])
    }
  }

  /** The pictures of tabs that closed, let go: `names` is each tab's lasting name before,
   *  by id, and `open` the tabs there are now. */
  closed(names: ReadonlyMap<string, string>, open: readonly Tab[]) {
    const now = lastingKeys(open)
    const still = new Set(now.values())
    // By the name the picture was written under as well: a title or a file changed since
    // the tabs last changed is another name than `names` has.
    const gone = [...names, ...this.written].filter(([id]) => !now.has(id))
    if (!gone.length) return
    const leaving = new Set(gone.map(([id]) => id))
    this.byId = Object.fromEntries(Object.entries(this.byId).filter(([id]) => !leaving.has(id)))
    for (const id of leaving) this.written.delete(id)
    void forgetFaces([...new Set(gone.map(([, name]) => name))].filter((name) => !still.has(name)))
  }
}

export const faces = new Faces()

void upgradeFaces()
upgradeWindows()

$effect.root(() => {
  /** The tab in front of each pane as last seen, which is photographed as it goes. */
  let fronts = new Map<string, string>()
  $effect.pre(() => {
    const now = new Map(workspace.panes.all.map((pane) => [pane.id, pane.activeTabId ?? '']))
    untrack(() => {
      for (const [paneId, id] of fronts) {
        if (!id || now.get(paneId) === id) continue
        const tab = workspace.tabs.find((one) => one.id === id)
        if (tab) faces.take(paneId, tab)
      }
      fronts = now
    })
  })

  // Each web page's photograph, as the engine takes a new one.
  $effect(() => {
    for (const tab of workspace.tabs) {
      if (tab.kind !== 'web') continue
      const shot = pages.of(tab.id).shot
      if (shot) untrack(() => faces.photographed(tab, shot))
    }
  })

  // A tab closed, its picture with it; once the tabs of the last run are back.
  let names = new Map<string, string>()
  $effect(() => {
    // Every tab read, so a tab gone is heard.
    const open = [...workspace.tabs]
    if (!workspace.restored) return
    untrack(() => {
      faces.closed(names, open)
      names = lastingKeys(open)
    })
  })
})
