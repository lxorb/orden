import { dropTarget, targetFor } from '../../tree/src/api'
import { dur, samePath } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { isUnsaved, type Tab } from '../../documents/src/api'
import { canWriteAt, mayCarryBetween } from '../../sharing/src/api'
import { type Landing, zoneAt } from '../../panes/src/api'
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
  const zone = zoneAt(box.getBoundingClientRect(), x, y, (side) => workspace.canLand(side, id, tabId))
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
function theirs(tab: Tab): boolean {
  if (tab.path === null) return tab.note.shared !== null
  const here = workspace.activeSpace?.root
  const from = workspace.rootHolding(tab.path)
  return (
    here !== undefined &&
    from !== null &&
    !samePath(from, here) &&
    (!canWriteAt(tab.path) || !mayCarryBetween(from, here))
  )
}
function filed(tabId: string) {
  const tab = workspace.tabs.find((one) => one.id === tabId)
  return tab && (isUnsaved(tab.note) || theirs(tab)) ? tab : null
}
export function overList(tabId: string, point: { x: number; y: number } | null): void {
  overSpaces({ tab: tabId }, point)
  overBookmarks(tabId, point)
  overChat(point)
  const folder = point && filed(tabId) ? folderAt(point.x, point.y) : null
  if (folder !== null) dropTarget.over(folder)
  else if (dropTarget.folder !== null) dropTarget.clear()
}
export function droppedOnList(tabId: string): void {
  const folder = dropTarget.folder
  const tab = filed(tabId)
  dropTarget.clear()
  if (droppedOnSpace({ tab: tabId }) || droppedOnBookmarks(tabId) || droppedOnChat(tabId)) return
  if (folder === null || !tab) return
  if (isUnsaved(tab.note)) void workspace.save(tab, folder)
  else void workspace.copyOwn(tab.note, folder)
}
const easeOut = () => getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'
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
