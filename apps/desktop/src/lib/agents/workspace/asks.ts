import type { AgentAnswer } from '../../automation/caller'
import { refusal } from '../../automation/caller'
import { invoke } from '../../platform/src/api'
import type { Category } from '../verbs'
import type { Call } from './call'
import { Refused } from './problem'

function fullPermissions(call: Call): boolean {
  return call.caller.agent?.mode === 'autonomous'
}

export function readersOwn(call: Call, why: string): void {
  if (!fullPermissions(call)) throw new Refused('by_hand', why)
}

function keyOf(call: Call): string {
  return `${call.verb}:${JSON.stringify(ordered(call.args))}`
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== 'object' || value === null) return value

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, ordered(record[key])]),
  )
}

export async function asked(
  call: Call,
  category: Category | null,
  summary: string,
  site?: string,
  quietly: Category = 'writing',
): Promise<AgentAnswer | null> {
  const agent = call.caller.agent
  if (agent === null || fullPermissions(call)) return null

  const about = category ?? (agent.mode === 'confirm' ? quietly : null)
  if (about === null) return null

  const said = await invoke<unknown>('agents_ask', {
    agent: agent.id,
    category: about,
    summary,
    key: keyOf(call),
    ...(site ? { site } : {}),
  }).catch((error: unknown) => ({ status: 'error', code: 'failed', message: String(error) }))

  return answered(said)
}

export function answered(said: unknown): AgentAnswer | null {
  const record = typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : {}
  const words = (key: string) => (typeof record[key] === 'string' ? record[key] : '')

  if (record.status === 'ok') return null
  if (record.status === 'needs_approval' && words('approval')) {
    return {
      ok: true,
      status: 'needs_approval',
      approval: words('approval'),
      summary: words('summary'),
    }
  }

  return refusal(words('code') || 'denied', words('message') || 'the reader was not asked')
}
