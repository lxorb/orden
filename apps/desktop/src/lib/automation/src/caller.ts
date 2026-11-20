import { type AgentAnswer, type AgentCaller as Caller, agentRefusal, type AgentScope as Scope } from '@orden/contracts'
import { isRecord } from '../../platform/src/api'

export type { AgentAnswer, Caller }
export const refusal = agentRefusal
let threadSpaces: (thread: string) => string | null = () => null
export function answerThreadSpaces(lookup: (thread: string) => string | null): void {
  threadSpaces = lookup
}
export function threadSpaceOf(caller: Caller): string | null {
  return caller.agent && caller.thread ? threadSpaces(caller.thread) : null
}
export const READER: Caller = { agent: null }
function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}
const CHAT_MODES = ['approve', 'auto', 'full', 'plan'] as const
type ChatMode = (typeof CHAT_MODES)[number]
const isChatMode = (value: unknown): value is ChatMode => CHAT_MODES.some((one) => one === value)
function chatOf(told: unknown) {
  if (!isRecord(told) || !isChatMode(told.mode)) return null
  const without = texts(told.without)
  return {
    mode: told.mode,
    ...(without.length ? { without } : {}),
    ...(Array.isArray(told.only) ? { only: texts(told.only) } : {}),
    ...(typeof told.space === 'string' && told.space ? { space: told.space } : {}),
  }
}
export function callerOf(told: unknown, thread?: unknown): Caller {
  if (told === undefined || told === null) return READER
  const grant = isRecord(told) ? told : {}
  const id = typeof grant.id === 'string' && grant.id ? grant.id : 'agent'
  const builtIn = grant.built_in === true
  const threadOf = builtIn && typeof thread === 'string' && /^[\w-]{1,80}$/.test(thread) ? { thread } : {}
  const chat = builtIn ? chatOf(grant.chat) : null
  return {
    agent: {
      id,
      builtIn,
      name: typeof grant.name === 'string' && grant.name ? grant.name : id,
      scopes: texts(grant.scopes),
      spaces: grant.spaces === 'all' ? 'all' : texts(grant.spaces),
      mode: grant.mode === 'unsupervised' || grant.mode === 'autonomous' ? grant.mode : 'confirm',
      programs: texts(grant.programs),
      sites: isRecord(grant.sites)
        ? Object.fromEntries(
            Object.entries(grant.sites).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
          )
        : {},
    },
    ...threadOf,
    ...(chat ? { chat } : {}),
  }
}
export const fullPermissions = (grant: { mode?: string } | null | undefined): boolean => grant?.mode === 'autonomous'
export function holds(caller: Caller, scope: Scope): boolean {
  return caller.agent === null || fullPermissions(caller.agent) || caller.agent.scopes.includes(scope)
}
