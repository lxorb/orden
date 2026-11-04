/** What is in front of the reader, as a message to the agent goes with it: the note in
 *  front while it is a note of the thread's space, and the words selected in it. One
 *  reading for every place a chat is started (#1115) - the panel's field and the quick
 *  question - so a chat started anywhere is sent what one started in the panel is. What
 *  each place lets the reader take off again is its own; see Composer.svelte and
 *  quick.svelte.ts. */

import { withinSpace } from '../../space-paths'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import type { Front, Picked } from './gather'
import type { Mention } from './mentions'

/** The note in front, while it is a note of the space at `root`. */
export function noteInFront(root: string | null): Front | null {
  const tab = workspace.panelTab
  if (tab?.kind !== 'note' || !tab.path || !root) return null
  const path = withinSpace(root, tab.path)
  if (path === null) return null
  return { path, name: tab.shown, text: tab.note.latest }
}

/** The words selected now, and the document they are in, which says whose they may be. */
export function selectionHere(): { text: string; picked: Picked | null } {
  const text = views.chosen > 0 ? views.selectedText() : ''
  if (!text.trim()) return { text: '', picked: null }
  const holder = workspace.tabs.find((tab) => tab.note.live === views.selectedIn())
  return { text, picked: holder ? { path: holder.path, shared: holder.note.shared } : null }
}

/** The chip the selection goes as. */
export const SELECTION_CHIP: Mention = { kind: 'selection', id: 'selection', label: 'selection' }
