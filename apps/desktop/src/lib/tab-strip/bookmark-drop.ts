import { landing, place } from '../essentials.svelte'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import { workspace } from '../workspace.svelte'

const ATTRIBUTE = 'data-bookmark-drop'

function markOf(tabId: string): Bookmark | null {
  const path = workspace.tabs.find((one) => one.id === tabId)?.path
  return path ? workspace.bookmarks.forEntry({ path, is_dir: false }) : null
}

export function overBookmarks(tabId: string, point: { x: number; y: number } | null): void {
  const under = point ? document.elementFromPoint(point.x, point.y) : null
  const zone = under?.closest<HTMLElement>(`[${ATTRIBUTE}]`)
  if (!point || !zone || !markOf(tabId)) {
    landing.clear()
    return
  }

  if (!landing.near(zone, point.x, point.y)) landing.over(workspace.bookmarks.list.length, false)
}

export function droppedOnBookmarks(tabId: string): boolean {
  const at = landing.at
  const after = landing.after
  landing.clear()

  const mark = markOf(tabId)
  if (at === null || !mark) return false

  place([mark], after ? at + 1 : at)
  return true
}
