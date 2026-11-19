import type { SharedDoc } from '@orden/editor'
import { withinSpace } from '../../../platform/src/api'
import { views } from '../../../panes/src/api'
import { protection } from '../../../protect/src/api'
import { workspace } from '../../../workspace/src/api'
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

export const SHUT_TO_AGENTS = 'This note is protected: unlock it and choose Let agents read in its menu.'

export function agentsMayRead(shows: SharedDoc | null, place: string | null = null): boolean {
  if (place !== null) return protection.agentsMay(place)
  const tab = shows ? workspace.tabs.find((one) => one.note.live === shows) : undefined
  if (tab) return protection.agentsMay(tab.path)
  const open = workspace.activeSpace?.root
  return open ? protection.agentsMayAll(open) : !protection.any
}

export const SELECTION_CHIP: Mention = { kind: 'selection', id: 'selection', label: 'selection' }
