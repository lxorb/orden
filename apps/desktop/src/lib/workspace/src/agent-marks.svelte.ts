export interface Worn {
  agent: string
  colour: string
  stopped: boolean
}
export type TabAct = 'stop' | 'resume'
class AgentMarks {
  on = $state<Record<string, Worn>>({})
  heard = $state(false)
  opened = $state<Record<string, string>>({})
  open = $state<string | null>(null)
  waiting = $state(0)
  takeovers = $state<Record<string, { id: string; reason: string }>>({})
  holding = false
  act: ((tab: string, what: TabAct) => void) | null = null
  hide: (() => Promise<boolean>) | null = null
}
export const agentMarks = new AgentMarks()
