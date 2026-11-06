import { withinSpace } from '../../space-paths'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import type { Front, Picked } from './gather'
import type { Mention } from './mentions'

export function noteInFront(root: string | null): Front | null {
  const tab = workspace.panelTab
  if (tab?.kind !== 'note' || !tab.path || !root) return null
  const path = withinSpace(root, tab.path)
  if (path === null) return null
  return { path, name: tab.shown, text: tab.note.latest }
}

export function selectionHere(): { text: string; picked: Picked | null } {
  const text = views.chosen > 0 ? views.selectedText() : ''
  if (!text.trim()) return { text: '', picked: null }
  const holder = workspace.tabs.find((tab) => tab.note.live === views.selectedIn())
  return { text, picked: holder ? { path: holder.path, shared: holder.note.shared } : null }
}

export const SELECTION_CHIP: Mention = { kind: 'selection', id: 'selection', label: 'selection' }
