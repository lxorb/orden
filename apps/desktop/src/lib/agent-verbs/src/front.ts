import { agentMarks } from '../../workspace/src/api'
import type { Tab } from '../../documents/src/api'
import type { Call } from './call'

export function openedBy(call: Call, tab: Tab | null | undefined, front: boolean): Tab | null {
  if (!tab) return null
  const agent = call.caller.agent
  if (!front && agent) agentMarks.opened = { ...agentMarks.opened, [tab.id]: agent.name }
  return tab
}
