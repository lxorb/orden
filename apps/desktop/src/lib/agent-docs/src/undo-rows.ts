import type { CommandExtension } from '@orden/contracts'
import { workspace } from '../../workspace/src/api'
import type { Agent } from './presence'
import { touchedBy } from './touched'

async function undo(agent: Agent, path: string) {
  const docs = await import('./index')
  await docs.undoAgentIn(agent, path)
}
export function undoRows(): CommandExtension[] {
  const path = workspace.active?.path
  if (!path) return []
  return touchedBy(path).map((agent) => ({
    id: `agent-undo:${agent.id}`,
    label: `Undo edits by ${agent.name}`,
    run: () => void undo(agent, path),
  }))
}
