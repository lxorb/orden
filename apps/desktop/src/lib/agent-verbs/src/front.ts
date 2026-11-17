import { agentMarks } from '../../workspace/src/api'
import type { Tab } from '../../documents/src/api'
import { type Call, flag, needScope } from './call'

export function asksFront(call: Call, why: string): boolean {
  const front = 'background' in call.args && !flag(call, 'background')
  if (front) needScope(call, 'workspace.focus', why)
  return front
}

export function openedBy(call: Call, tab: Tab | null | undefined, front: boolean): Tab | null {
  if (!tab) return null
  const agent = call.caller.agent
  if (!front && agent) agentMarks.opened = { ...agentMarks.opened, [tab.id]: agent.name }
  return tab
}
