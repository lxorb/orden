/** "Properties", from the palette or a key the reader gave it: the strip at the top of
 *  the note in front opened and the keyboard on it, which is where a note's front
 *  matter is read and changed now that no panel beside the note does (#1120). A note
 *  with none gets its first property; see `showProperties` in @orden/editor. */

import { type EditorView, showProperties } from '@orden/editor'
import { isMarkdownPath } from './space-paths'
import { views } from './views.svelte'
import { workspace } from './workspace.svelte'

/** The editor of the note in front, where it is Markdown, which is what has front
 *  matter. */
function noteView(): EditorView | null {
  const tab = workspace.active
  if (tab?.kind !== 'note' || (tab.path !== null && !isMarkdownPath(tab.path))) return null
  return views.of(workspace.panes.focusedId) ?? null
}

export function showNoteProperties(): void {
  const view = noteView()
  if (view) showProperties(view)
}
