import { views } from '../../../views.svelte'
import { workspace } from '../../../workspace.svelte'
import { chat } from './chat.svelte'
import { sameMention } from './mentions'
import { revealChat } from './reveal'

export function quoteSelection(): void {
  const view = views.of(workspace.panes.focusedId)
  const tab = workspace.active
  const range = view?.state.selection.main
  if (!view || !range || range.empty || tab?.kind !== 'note') return

  const doc = view.state.doc
  const first = doc.lineAt(range.from).number
  const last = doc.lineAt(range.to).number
  const label = first === last ? `${tab.shown}:${first}` : `${tab.shown}:${first}-${last}`
  const chip = {
    kind: 'words' as const,
    id: label,
    label,
    text: doc.sliceString(range.from, range.to),
    ...(tab.path ? { from: tab.path } : {}),
    ...(tab.note.shared !== null ? { theirs: true } : {}),
  }
  if (!chat.chips.some((one) => sameMention(one, chip))) chat.chips = [...chat.chips, chip]
  revealChat()
  chat.focus()
}
