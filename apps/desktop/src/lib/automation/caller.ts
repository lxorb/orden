import type { Scope } from '../agents/verbs'

interface Agent {
  id: string
  builtIn: boolean
  name: string
  scopes: readonly string[]
  spaces: 'all' | readonly string[]
  mode: 'unsupervised' | 'confirm' | 'autonomous'
  programs: readonly string[]
  sites: Readonly<Record<string, string>>
}

export type Caller = { agent: null } | { agent: Agent; thread?: string }

let threadSpaces: (thread: string) => string | null = () => null

export function answerThreadSpaces(lookup: (thread: string) => string | null): void {
  threadSpaces = lookup
}

export function threadSpaceOf(caller: Caller): string | null {
  return caller.agent && caller.thread ? threadSpaces(caller.thread) : null
}

export const READER: Caller = { agent: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

export function callerOf(told: unknown, thread?: unknown): Caller {
  if (told === undefined || told === null) return READER

  const grant = isRecord(told) ? told : {}
  const id = typeof grant.id === 'string' && grant.id ? grant.id : 'agent'
  const builtIn = grant.built_in === true
  const threadOf =
    builtIn && typeof thread === 'string' && /^[\w-]{1,80}$/.test(thread) ? { thread } : {}
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
            Object.entries(grant.sites).filter(
              (pair): pair is [string, string] => typeof pair[1] === 'string',
            ),
          )
        : {},
    },
    ...threadOf,
  }
}

export function holds(caller: Caller, scope: Scope): boolean {
  return caller.agent === null || caller.agent.scopes.includes(scope)
}

export type AgentAnswer =
  | { ok: true; status: 'ok'; result: unknown; untrusted?: string }
  | { ok: true; status: 'needs_approval'; approval: string; summary: string }
  | { ok: false; status: 'error'; code: string; message: string; error: string }

export function refusal(code: string, message: string): AgentAnswer {
  return { ok: false, status: 'error', code, message, error: message }
}
