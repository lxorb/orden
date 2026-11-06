import { carriedNothing, carry, carryTab } from '../drag-paths'
import { workspace } from '../workspace.svelte'

const ATTRIBUTE = 'data-chat-drop'

let under: Element | null = null

export function overChat(point: { x: number; y: number } | null): void {
  const at = point ? document.elementFromPoint(point.x, point.y) : null
  under = at?.closest(`[${ATTRIBUTE}]`) ? at : null
}

export function droppedOnChat(tabId: string): boolean {
  const on = under
  under = null
  const tab = workspace.tabs.find((one) => one.id === tabId)
  if (!on || !tab || on.closest(`[${ATTRIBUTE}]`)?.getAttribute(ATTRIBUTE) === tabId) return false

  const transfer = new DataTransfer()
  if (tab.kind === 'web') carryTab(transfer, tabId)
  else if (tab.path) carry(transfer, [tab.path])
  else return false
  on.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  )
  carriedNothing()
  return true
}
