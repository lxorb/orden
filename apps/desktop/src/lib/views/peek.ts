/** The note a view's row opens beside the view, Notion's side peek (docs/tasks.md 5.9):
 *  one pane to the right of the view's pane, made by the first row opened and taken
 *  over by every next one, so a board clicked through is one pane beside it and never
 *  a row of them. `walk` is the view's notes in its order, which Ctrl+Shift+J and K
 *  step through; Escape leaves the editor first, then closes the peek and gives the
 *  focus back to what opened it. On a phone it is the ordinary open, full screen.
 *
 *  Behind the views' door rather than in the workspace: only a view peeks. */

import { samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { Tab } from '../workspace/documents.svelte'

/** Which views peek where: by the view's pane, the peek's tab, the view's notes in
 *  order, and what had the focus when the peek opened. */
const peeks = new Map<string, { tab: string; walk: string[]; back: HTMLElement | null }>()
let listening = false

/** Peeks at `path` beside the view in pane `from`. `walking` is a step with
 *  Ctrl+Shift+J or K, which keeps the focus to go back to that the first look had;
 *  a press on a card in the view makes that card the one to go back to. */
export async function peek(
  path: string,
  walk: readonly string[] = [],
  from = workspace.panes.focusedId,
  walking = false,
): Promise<void> {
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const held = peeks.get(from)
  const old = held ? workspace.tabs.find((one) => one.id === held.tab) : undefined
  if (old && old.paneId !== from && workspace.panes.at(old.paneId)) {
    const pane = old.paneId
    if (!samePath(old.path, path)) {
      workspace.panes.focus(pane)
      await showIn(pane, path, old)
    }
    const now = workspace.active
    if (now?.paneId === pane) {
      const gone = now.id === old.id ? undefined : workspace.tabs.find((one) => one.id === old.id)
      if (gone && !gone.dirty && !gone.pinned) workspace.close(gone.id, false)
      peeks.set(from, { tab: now.id, walk: [...walk], back: walking ? (held?.back ?? back) : back })
    } else workspace.activeTabId = old.id
    return
  }

  // The peek is the tab the open made: a tab of the note already open in another
  // pane is the reader's own, and closing it with Escape would close their work.
  const before = new Set(workspace.tabs.map((one) => one.id))
  const showing = workspace.panes.at(from)?.activeTabId ?? null
  await workspace.openAside(path)
  const now = workspace.tabs.find(
    (one) =>
      !before.has(one.id) &&
      one.paneId !== from &&
      samePath(one.path, path) &&
      workspace.panes.at(one.paneId)?.activeTabId === one.id,
  )
  if (!now) return
  // The open passes through the view's pane on its way to the new one, which leaves
  // that pane on its last tab rather than on the view.
  const left = showing === null ? undefined : workspace.tabs.find((one) => one.id === showing)
  if (left?.paneId === from) workspace.panes.activate(from, left.id)
  peeks.set(from, { tab: now.id, walk: [...walk], back })
  // Only being looked at, so the next look may take its place.
  if (!workspace.tabs.some((one) => one.id !== now.id && one.note === now.note))
    workspace.previewTabId = now.id
  if (!listening) {
    listening = true
    window.addEventListener('keydown', key)
  }
}

/** The next note shown in the peek's pane. A note open already, here or in another
 *  pane, gets a second view of itself in the peek, the way `openAside` makes one:
 *  the ordinary open would bring the pane showing it forward instead, which is the
 *  reader's own pane or the view's. */
async function showIn(pane: string, path: string, old: Tab) {
  const open = workspace.tabs.find((one) => samePath(one.path, path) && one.kind === 'note')
  if (!open) {
    await workspace.openEntry(path, { preview: true })
    return
  }
  const tab = new Tab(open.note, pane)
  const tabs = [...workspace.tabs]
  tabs.splice(tabs.findIndex((one) => one.id === old.id) + 1, 0, tab)
  workspace.tabs = tabs
  workspace.activeTabId = tab.id
  workspace.persist()
}

/** The keys a peek answers, after everything that had them first. */
function key(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  const active = workspace.active
  if (!active) return
  const entry = [...peeks].find(([from, one]) => one.tab === active.id || from === active.paneId)
  if (!entry) return
  const [from, held] = entry
  const tab = workspace.tabs.find((one) => one.id === held.tab)
  if (!tab || !workspace.panes.at(tab.paneId) || tab.paneId === from) {
    peeks.delete(from)
    return
  }
  const target = event.target instanceof HTMLElement ? event.target : null
  const mod = event.ctrlKey || event.metaKey
  const letter = event.key.toLowerCase()
  if (mod && event.shiftKey && !event.altKey && (letter === 'j' || letter === 'k')) {
    // Typing in the view, its search or a cell, keeps its keys; the peek's own editor
    // has had them first and left them.
    if (active.paneId === from && target && writable(target)) return
    const at = held.walk.findIndex((one) => samePath(one, tab.path))
    const next = held.walk[at + (letter === 'j' ? 1 : -1)]
    if (at === -1 || next === undefined) return
    event.preventDefault()
    void peek(next, held.walk, from, true)
    return
  }
  if (event.key !== 'Escape' || mod || event.shiftKey || event.altKey) return
  if (active.id !== tab.id || !target) return
  if (target.closest('input, textarea, select, [role=dialog], .nib-layer')) return
  event.preventDefault()
  if (target.isContentEditable) {
    target.blur()
    return
  }
  peeks.delete(from)
  workspace.close(tab.id, false)
  if (workspace.panes.at(from)) workspace.panes.focus(from)
  if (held.back?.isConnected) held.back.focus()
}

/** Whether keys pressed at `target` are typing. */
function writable(target: HTMLElement): boolean {
  return target.isContentEditable || target.closest('input, textarea, select') !== null
}
