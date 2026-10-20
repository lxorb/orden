/** Rows of the file list let go of on the AI panel, as chips in its field (#416): a
 *  folder the way `@` offers one, anything else as a note. Any other drop is left to
 *  what it is over: a file, to the field. */

import { carriedRows } from '../../drag-paths'
import { workspace } from '../../workspace.svelte'
import { chat } from './chat.svelte'
import { mentionOf, sameMention } from './mentions'

export function dropRows(event: DragEvent): void {
  const rows = carriedRows(event.dataTransfer).flatMap((path) => workspace.entryAt(path) ?? [])
  if (!rows.length) return

  event.preventDefault()
  const fresh = rows
    .map(mentionOf)
    .filter((one) => !chat.chips.some((had) => sameMention(had, one)))
  chat.chips = [...chat.chips, ...fresh]
  chat.focus()
}
