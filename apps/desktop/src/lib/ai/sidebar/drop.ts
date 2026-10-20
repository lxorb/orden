/** Rows of the file list let go of on the AI panel, as chips in its field (#416): a
 *  folder the way `@` offers one, anything else as a note; and a web tab let go of on
 *  it (tab-strip/chat-drop.ts) as its page. Any other drop is left to what it is over:
 *  a file, to the field. */

import { carriedRows, draggedTab } from '../../drag-paths'
import { workspace } from '../../workspace.svelte'
import { chat } from './chat.svelte'
import { type Mention, mentionOf, sameMention } from './mentions'

export function dropRows(event: DragEvent): void {
  const rows = carriedRows(event.dataTransfer).flatMap((path) => workspace.entryAt(path) ?? [])
  const web = workspace.tabs
    .filter((one) => one.id === draggedTab(event.dataTransfer))
    .map((one): Mention => ({ kind: 'tab', id: one.id, label: one.shown, word: 'tab' }))
  if (!rows.length && !web.length) return

  event.preventDefault()
  const fresh = [...rows.map(mentionOf), ...web].filter(
    (one) => !chat.chips.some((had) => sameMention(had, one)),
  )
  chat.chips = [...chat.chips, ...fresh]
  chat.focus()
}
