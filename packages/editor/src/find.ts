/** Finding words in the note, and putting other words in their place.
 *
 *  CodeMirror's own panel is the whole of it, replace field and all, so there is
 *  nothing here that opens a second one. What is here is the names: Find, Replace,
 *  next and previous as commands with ids, so each can carry a key a reader
 *  chooses and a row in a menu, rather than being keys the library happens to
 *  bind. See keymap.ts, which adopts the library's own bindings the same way. */

import { openSearchPanel } from '@codemirror/search'
import type { Command, EditorView } from '@codemirror/view'

/** The replace field of this view's own panel, when the panel is up. */
function replaceField(view: EditorView): HTMLInputElement | null {
  return view.dom.querySelector<HTMLInputElement>('.cm-panel.cm-search input[name="replace"]')
}

/** Find, with the keyboard in the replace field instead of the search one.
 *
 *  The panel is mounted while the transaction that opened it is applied, so the
 *  field is usually there to focus at once. Usually is not always - a panel that
 *  animates in is measured first - so a second attempt follows on the next frame
 *  and does nothing if the first one worked. */
export const openReplace: Command = (view) => {
  // A note nothing can be written into has no replace field: the panel leaves it
  // out. Find still opens, which is the honest answer to asking for replace.
  openSearchPanel(view)
  if (view.state.readOnly) return true

  if (!take(view)) requestAnimationFrame(() => void take(view))
  return true
}

function take(view: EditorView): boolean {
  const field = replaceField(view)
  if (!field) return false

  field.select()
  field.focus()
  return true
}

export { findNext, findPrevious, openSearchPanel as openFind } from '@codemirror/search'
