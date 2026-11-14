import { without } from '../../platform/src/api'
import type { AgentEvent, AgentTab, Approval, Grant, Overview } from '../verbs'

interface Held extends AgentTab {
  agent: string
}

interface Touch {
  agent: string
  verb: string
  at: number
}

export interface Seen {
  agents: Grant[]
  tabs: Record<string, Held>
  approvals: Approval[]
  stopped: number | null
  halted: Record<string, number>
  connected: string[]
  acting: Record<string, Touch>
  doing: Record<string, Touch & { tab: string | null }>
}

export function nothing(): Seen {
  return {
    agents: [],
    tabs: {},
    approvals: [],
    stopped: null,
    halted: {},
    connected: [],
    acting: {},
    doing: {},
  }
}

export function overviewed(seen: Seen, overview: Overview, now: number): void {
  seen.agents = overview.agents
  seen.tabs = Object.fromEntries(
    overview.tabs.map(([agent, tab]) => [tab.id, { ...tab, agent }] as const),
  )
  seen.approvals = overview.approvals.filter((one) => one.answer === 'pending')
  seen.stopped = overview.stopped ? (seen.stopped ?? now) : null
  seen.halted = Object.fromEntries(
    overview.halted.map((agent) => [agent, seen.halted[agent] ?? now]),
  )
  seen.connected = overview.connected
}

export function heard(seen: Seen, event: AgentEvent, now: number): void {
  switch (event.kind) {
    case 'acting': {
      const touch = { agent: event.agent, verb: event.verb, at: now }
      seen.acting[event.tab] = touch
      seen.doing[event.agent] = { ...touch, tab: event.tab }
      if (!seen.connected.includes(event.agent)) seen.connected = [...seen.connected, event.agent]
      return
    }
    case 'paused':
      seen.halted[event.agent] = now
      return
    case 'resumed':
      resumed(seen, event.agent)
      return
    case 'asked':
      seen.approvals = [
        ...seen.approvals.filter((one) => one.id !== event.approval.id),
        event.approval,
      ]
      return
    case 'answered':
      seen.approvals = seen.approvals.filter((one) => one.id !== event.approval.id)
      return
    case 'tab': {
      const was = seen.tabs[event.id]
      seen.tabs[event.id] = {
        id: event.id,
        agent: event.agent,
        url: event.url,
        title: event.title,
        loading: was?.loading ?? false,
        store: was?.store ?? 'reader',
        parked: false,
      }
      return
    }
    case 'closed':
      closed(seen, event.id)
      return
    case 'stopped':
      seen.stopped ??= now
      if (event.closed) for (const id of Object.keys(seen.tabs)) closed(seen, id)
      return
    case 'connected':
      seen.connected = event.agents
      return
  }
}

function resumed(seen: Seen, agent: string): void {
  if (agent === '') {
    seen.stopped = null
    seen.halted = {}
    return
  }

  seen.halted = without(seen.halted, agent)
}

function closed(seen: Seen, id: string): void {
  seen.tabs = without(seen.tabs, id)
  seen.acting = without(seen.acting, id)
}

export function wrote(seen: Seen, agent: string, tabs: readonly string[], now: number): void {
  for (const tab of tabs) seen.acting[tab] = { agent, verb: 'edit_note', at: now }
  seen.doing[agent] = { agent, verb: 'edit_note', at: now, tab: tabs[0] ?? null }
}

export function isStopped(seen: Seen, agent: string): boolean {
  return seen.stopped !== null || agent in seen.halted
}
