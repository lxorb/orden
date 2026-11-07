import { door } from '@orden/markdown/door'
import { isDesktop } from './tauri'

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

  waiting = $state(0)

  takeovers = $state<Record<string, { id: string; reason: string }>>({})

  holding = false

  act: ((tab: string, what: TabAct) => void) | null = null

  hide: (() => Promise<boolean>) | null = null
}

export const agentMarks = new AgentMarks()

export async function listenForAgents(): Promise<() => void> {
  if (__EVEN_PLUGIN__ || !isDesktop) return () => undefined

  const { listen } = await import('@tauri-apps/api/event')
  const heard = door(() => import('./agents/ui/index').then(({ start }) => start()))

  return listen<unknown>('orden://agent', ({ payload }) => {
    void heard().then((hear) => hear(payload))
  })
}
