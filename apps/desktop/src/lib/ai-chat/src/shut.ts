import type { SharedDoc } from '@orden/editor'
import { protection } from '../../protect/src/api'
import { workspace } from '../../workspace/src/api'

export const SHUT_HERE = 'This note is shut to agents: choose Let agents read in its menu first.'

export function shutToAgents(doc: SharedDoc | null, place: string | null = null): boolean {
  if (place !== null) return !protection.agentsMay(place)
  const holder = doc ? workspace.tabs.find((tab) => tab.note.live === doc) : undefined
  const path = holder ? holder.path : (workspace.active?.path ?? null)
  return !protection.agentsMay(path ?? '')
}
