import type { Call } from '../ui/session'

export interface Session {
  agent: string
  start: number
  end: number
  calls: Call[]
}

export const SESSION_GAP = 30 * 60 * 1000

export function sessionsOf(calls: readonly Call[], agent: string): Session[] {
  const own = calls.filter((one) => one.agent === agent).sort((a, b) => a.at - b.at)
  const sessions: Session[] = []

  for (const call of own) {
    const last = sessions.at(-1)
    if (last && call.at - last.end <= SESSION_GAP) {
      last.calls.push(call)
      last.end = call.at
    } else {
      sessions.push({ agent, start: call.at, end: call.at, calls: [call] })
    }
  }

  return sessions.reverse()
}

export function lastActive(calls: readonly Call[]): Map<string, number> {
  const last = new Map<string, number>()
  for (const call of calls) last.set(call.agent, Math.max(call.at, last.get(call.agent) ?? 0))
  return last
}
