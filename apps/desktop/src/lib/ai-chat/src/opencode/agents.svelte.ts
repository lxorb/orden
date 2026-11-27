import { keepJson, stored } from '../../../platform/src/api'

const KEY = 'orden:opencode-agents'
export const FIRST_AGENT = 'build'
interface AgentRow {
  name: string
  description: string
}
const BUILT_IN: AgentRow[] = [
  { name: 'build', description: 'Works on your notes with the tools you allow' },
  { name: 'plan', description: 'Reads and plans, changes nothing' },
]
function kept(): Record<string, string> {
  const value = stored(KEY)
  return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}
}
class OpenCodeAgents {
  chosen = $state<Record<string, string>>(kept())
  rows = $state.raw<AgentRow[]>(BUILT_IN)
  of(thread: string): string {
    return this.chosen[thread] ?? FIRST_AGENT
  }
  choose(thread: string, name: string): void {
    this.chosen = { ...this.chosen, [thread]: name }
    keepJson(KEY, this.chosen)
  }
  async load(): Promise<void> {
    const { opencode } = await import('../../../opencode-client/src/api')
    const listed = await opencode.agents().catch(() => null)
    if (!listed) return
    const shown = listed.filter((one) => one.mode !== 'subagent' && !one.hidden)
    if (shown.length) this.rows = shown.map((one) => ({ name: one.name, description: one.description ?? '' }))
  }
}
export const openCodeAgents = new OpenCodeAgents()
export const agentName = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)
