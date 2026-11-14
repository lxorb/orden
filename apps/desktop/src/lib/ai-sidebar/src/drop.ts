import { carriedRows, draggedTab } from '../../drag-paths'
import { workspace } from '../../workspace.svelte'
import { chat } from './chat-parts'
import { type Mention, mentionOf, sameMention } from './chat-parts'

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
