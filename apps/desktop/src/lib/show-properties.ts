import { type EditorView, showProperties } from '@orden/editor'
import { isMarkdownPath } from './space-paths'
import { views } from './views.svelte'
import { workspace } from './workspace.svelte'

function noteView(): EditorView | null {
  const tab = workspace.active
  if (tab?.kind !== 'note' || (tab.path !== null && !isMarkdownPath(tab.path))) return null
  return views.of(workspace.panes.focusedId) ?? null
}

export function showNoteProperties(): void {
  const view = noteView()
  if (view) showProperties(view)
}
