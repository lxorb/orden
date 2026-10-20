/** A tab let go of over a chat is linked in it (#416): handed to the chat as the drop of
 *  its file's row (chats/view/ChatTab.svelte, ai/sidebar/drop.ts), on what the pointer
 *  was over. A chat says it takes one with `data-chat-drop`, the id of its own tab, so a
 *  chat's own tab let go of over it links nothing. */

import { carriedNothing, carry } from '../drag-paths'
import { workspace } from '../workspace.svelte'

const ATTRIBUTE = 'data-chat-drop'

let under: Element | null = null

/** Over a chat at `point`, or over nothing of one where that is null. */
export function overChat(point: { x: number; y: number } | null): void {
  const at = point ? document.elementFromPoint(point.x, point.y) : null
  under = at?.closest(`[${ATTRIBUTE}]`) ? at : null
}

/** Let go of: dropped on the chat it was over. Answers whether there was one. */
export function droppedOnChat(tabId: string): boolean {
  const on = under
  under = null
  const path = workspace.tabs.find((one) => one.id === tabId)?.path
  if (!on || !path || on.closest(`[${ATTRIBUTE}]`)?.getAttribute(ATTRIBUTE) === tabId) return false

  const transfer = new DataTransfer()
  carry(transfer, [path])
  on.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  )
  carriedNothing()
  return true
}
