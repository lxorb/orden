import { isRecord, invoke } from '../../../platform/src/api'
import {
  AGENT_EVENT,
  type AgentEvent,
  type Category,
  type Grant,
  type Minted,
  type Scope,
  type SiteRule,
} from '../verbs'

export interface AgentsCrate {
  read(): Promise<Grant[]>
  write(grants: Grant[]): Promise<Grant[]>
  mint(name: string): Promise<Minted>
  days(): Promise<string[]>
  day(day: string): Promise<unknown[]>
  clear(agent: string | null): Promise<void>
  program(): Promise<string | null>
  hear(on: (event: Heard) => void): Promise<() => void>
}

const known = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  list.find((one) => one === value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export interface Heard {
  kind: AgentEvent['kind']
  agent: string | null
}

const KINDS: readonly AgentEvent['kind'][] = [
  'acting',
  'paused',
  'resumed',
  'asked',
  'answered',
  'tab',
  'closed',
  'stopped',
]

function readHeard(value: unknown): Heard | null {
  if (!isRecord(value)) return null
  const kind = known(KINDS, value.kind)
  if (!kind) return null
  const agent = isRecord(value.approval) ? value.approval.agent : value.agent
  return { kind, agent: typeof agent === 'string' ? agent : null }
}

const SCOPES: readonly Scope[] = [
  'context',
  'notes.read',
  'notes.write',
  'chats.read',
  'chats.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.script',
  'browser.network',
  'browser.storage',
  'settings',
  'terminal',
  'files',
  'processes',
  'network',
  'clipboard',
  'ask',
  'editor',
  'applications',
  'agents',
]

const CATEGORIES: readonly Category[] = [
  'paying',
  'sending',
  'publishing',
  'deleting',
  'signing_in',
  'settings',
  'terminal',
  'files',
  'writing',
  'trashing',
  'unread',
  'showing',
  'takeover',
  'pairing',
]

const RULES: readonly SiteRule[] = ['allow', 'deny', 'agent-store']

export function readGrant(value: unknown): Grant | null {
  if (!isRecord(value)) return null
  const {
    id,
    name,
    client,
    scopes,
    spaces,
    sites,
    scripts,
    mode,
    asks,
    always,
    programs,
    limits,
    created,
  } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof client !== 'string') return null

  const limited = isRecord(limits) ? limits : {}
  return {
    id,
    name,
    client,
    scopes: strings(scopes).flatMap((one) => known(SCOPES, one) ?? []),
    spaces: spaces === 'all' ? 'all' : strings(spaces),
    sites: Object.fromEntries(
      Object.entries(isRecord(sites) ? sites : {}).flatMap(([site, rule]) => {
        const said = known(RULES, rule)
        return said ? [[site, said]] : []
      }),
    ),
    scripts: strings(scripts),
    mode: mode === 'confirm' ? 'confirm' : 'unsupervised',
    asks: Object.fromEntries(
      Object.entries(isRecord(asks) ? asks : {}).flatMap(([category, on]) =>
        known(CATEGORIES, category) && typeof on === 'boolean' ? [[category, on]] : [],
      ),
    ),
    always: Object.fromEntries(
      Object.entries(isRecord(always) ? always : {}).map(([site, categories]) => [
        site,
        strings(categories).flatMap((one) => known(CATEGORIES, one) ?? []),
      ]),
    ),
    programs: strings(programs),
    limits: {
      tabs: count(limited.tabs, 4),
      calls: count(limited.calls, 600),
      navigations: count(limited.navigations, 60),
      memory: count(limited.memory, 0),
    },
    created: count(created, 0),
  }
}

function readGrants(value: unknown): Grant[] {
  return Array.isArray(value) ? value.flatMap((one) => readGrant(one) ?? []) : []
}

function readMinted(value: unknown): Minted {
  const grant = isRecord(value) ? readGrant(value.grant) : null
  const token = isRecord(value) ? value.token : null
  if (!grant || typeof token !== 'string') throw new Error('the agent could not be made')
  return { grant, token }
}

export const tauriCrate: AgentsCrate = {
  read: async () => readGrants(await invoke<unknown>('agents_read')),
  write: async (grants) => readGrants(await invoke<unknown>('agents_write', { grants })),
  mint: async (name) => readMinted(await invoke<unknown>('agents_mint', { name })),
  days: async () => strings(await invoke<unknown>('agents_log_days')),
  day: async (day) => {
    const lines = await invoke<unknown>('agents_log', { day })
    return Array.isArray(lines) ? lines.map((line: unknown) => line) : []
  },
  clear: (agent) => invoke('agents_log_clear', { agent }),
  program: () =>
    invoke<unknown>('mcp_program').then(
      (path) => (typeof path === 'string' && path ? path : null),
      () => null,
    ),
  hear: async (on) => {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<unknown>(AGENT_EVENT, ({ payload }) => {
      const heard = readHeard(payload)
      if (heard) on(heard)
    })
  },
}
