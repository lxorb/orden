import { dropTarget, targetFor } from '../drop-target.svelte'
import { dur } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'
import type { Landing } from '../workspace/panes.svelte'
import { zoneAt } from '../workspace/zones'
import type { Bounds } from './layout'
import { keyOf, stripOf, type TabDrag } from './drag.svelte'
import { droppedOnBookmarks, overBookmarks } from './bookmark-drop'
import { droppedOnChat, overChat } from './chat-drop'
import { droppedOnSpace, overSpaces } from './space-drop'

function landingAt(x: number, y: number, tabId: string, paneId: string): Landing | null {
  const under = document.elementFromPoint(x, y)
  const other = under?.closest<HTMLElement>('[data-strip]')

  if (other) {
    const id = other.dataset.strip ?? ''
    const at = id === paneId ? undefined : stripOf(id)?.slotAt(x)
    return at === undefined ? null : { kind: 'strip', paneId: id, at }
  }

  const box = under?.closest<HTMLElement>('[data-pane]')
  const id = box?.dataset.pane
  if (!box || !id) return null

  const zone = zoneAt(box.getBoundingClientRect(), x, y, (side) =>
    workspace.canLand(side, id, tabId),
  )
  if (zone === 'middle' && under?.closest('[data-chat-drop]')) return null
  return zone === 'middle' && id === paneId ? null : { kind: 'pane', paneId: id, zone }
}

export function follow(drag: TabDrag, paneId: string) {
  const tabId = drag.tabId
  if (!tabId) return

  const where = drag.out ? landingAt(drag.pointer.x, drag.pointer.y, tabId, paneId) : null
  if (keyOf(workspace.panes.landing) !== keyOf(where)) workspace.panes.landing = where
  overList(tabId, drag.out && !where ? drag.pointer : null)

  const carried = drag.out ? tabId : null
  if ((workspace.panes.dragging?.tabId ?? null) !== carried) {
    workspace.panes.dragging = carried ? { tabId: carried } : null
  }
}

function folderAt(x: number, y: number): string | null {
  const under = document.elementFromPoint(x, y)
  const row = under?.closest<HTMLElement>('[data-path]')
  const path = row?.dataset.path
  if (path) return targetFor(path, row.hasAttribute('aria-expanded'))

  return under?.closest('[data-space-rest]') ? (workspace.activeSpace?.root ?? null) : null
}

function unsaved(tabId: string) {
  const tab = workspace.tabs.find((one) => one.id === tabId)
  return tab && isUnsaved(tab.note) ? tab : null
}

export function overList(tabId: string, point: { x: number; y: number } | null): void {
  overSpaces({ tab: tabId }, point)
  overBookmarks(tabId, point)
  overChat(point)
  const folder = point && unsaved(tabId) ? folderAt(point.x, point.y) : null
  if (folder !== null) dropTarget.over(folder)
  else if (dropTarget.folder !== null) dropTarget.clear()
}

export function droppedOnList(tabId: string): void {
  const folder = dropTarget.folder
  const tab = unsaved(tabId)
  dropTarget.clear()
  if (droppedOnSpace({ tab: tabId }) || droppedOnBookmarks(tabId) || droppedOnChat(tabId)) return
  if (folder !== null && tab) void workspace.save(tab, folder)
}

const easeOut = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'

export function flyHome(
  find: () => readonly [HTMLElement | null | undefined, Bounds | undefined],
  from: { left: number; top: number },
  top: number,
) {
  requestAnimationFrame(() => {
    const [node, box] = find()
    if (!node || !box) return

    const rect = node.getBoundingClientRect()
    const x = box.x
    node.animate(
      [
        { transform: `translate(${x + from.left - rect.left}px, ${from.top - top - rect.top}px)` },
        { transform: `translate(${x}px, 0)` },
      ],
      { duration: dur(210), easing: easeOut() },
    )
  })
}
