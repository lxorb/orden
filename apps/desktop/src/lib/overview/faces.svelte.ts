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

const TAKE_LATER = 700

class Faces {
  private byId = $state.raw<Record<string, Face>>({})
  private written = new Map<string, string>()
  private reading: Promise<void> | null = null

  of(id: string): Face | null {
    return this.byId[id] ?? null
  }

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

  take(paneId: string, tab: Tab) {
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
    const before = this.written.get(tab.id)
    this.written.set(tab.id, name)
    if (before && before !== name && ![...names.values()].includes(before)) {
      void forgetFaces([before])
    }
  }

  closed(names: ReadonlyMap<string, string>, open: readonly Tab[]) {
    const now = lastingKeys(open)
    const still = new Set(now.values())
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

  $effect(() => {
    for (const tab of workspace.tabs) {
      if (tab.kind !== 'web') continue
      const shot = pages.of(tab.id).shot
      if (shot) untrack(() => faces.photographed(tab, shot))
    }
  })

  let names = new Map<string, string>()
  $effect(() => {
    const open = [...workspace.tabs]
    if (!workspace.restored) return
    untrack(() => {
      faces.closed(names, open)
      names = lastingKeys(open)
    })
  })
})
