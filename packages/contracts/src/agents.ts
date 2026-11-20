export type AgentScope =
  | 'context'
  | 'notes.read'
  | 'notes.write'
  | 'chats.read'
  | 'chats.write'
  | 'tree'
  | 'workspace'
  | 'workspace.focus'
  | 'browser'
  | 'browser.reader'
  | 'browser.script'
  | 'browser.network'
  | 'browser.storage'
  | 'settings'
  | 'agents'
  | 'terminal'
  | 'files'
  | 'processes'
  | 'network'
  | 'clipboard'
  | 'ask'
  | 'editor'
export interface AgentWritesPort {
  wrote(agent: string, tabs: readonly string[]): void
}
export interface AgentQuestion {
  readonly agent: string
  readonly kind: 'choice' | 'text'
  readonly message: string
  readonly choices: readonly string[]
  readonly placeholder: string | null
}
export interface AgentHeard {
  readonly kind: string
  readonly agent?: string | null
}
export interface AgentReaderPort {
  knows(agent: string, id: string): Promise<boolean>
  waiting(agent: string): Promise<number>
  ask(question: AgentQuestion): Promise<string>
  answer(id: string, answer: string | null): void
  heard(id: string, patience: number, signal: AbortSignal): Promise<{ answer: string | null } | null>
  hear(on: (heard: AgentHeard) => void): Promise<() => void>
}
export interface AgentMarksPort {
  keepMarksOf(agents: ReadonlySet<string>): void
}
export interface AgentPorts {
  readonly 'agents.writes': AgentWritesPort
  readonly 'agents.reader': AgentReaderPort
  readonly 'agents.marks': AgentMarksPort
  readonly 'agents.crate': AgentCrateAnswers
}
export interface AgentCrateAnswers {
  answer(name: string, args: AgentSaid): Promise<unknown>
}
export interface AgentGrant {
  readonly id: string
  readonly builtIn: boolean
  readonly name: string
  readonly scopes: readonly string[]
  readonly spaces: 'all' | readonly string[]
  readonly mode: 'unsupervised' | 'confirm' | 'autonomous'
  readonly programs: readonly string[]
  readonly sites: Readonly<Record<string, string>>
}
export interface AgentChat {
  readonly mode: 'approve' | 'auto' | 'full' | 'plan'
  readonly without?: readonly string[]
  readonly only?: readonly string[]
  readonly space?: string
}
export type AgentCaller = { agent: null } | { agent: AgentGrant; thread?: string; chat?: AgentChat }
export type AgentSaid = Record<string, unknown>
export type AgentAnswer =
  | { ok: true; status: 'ok'; result: unknown; untrusted?: string }
  | { ok: true; status: 'needs_approval'; approval: string; summary: string }
  | { ok: false; status: 'error'; code: string; message: string; error: string }
export const agentRefusal = (code: string, message: string): AgentAnswer => ({
  ok: false,
  status: 'error',
  code,
  message,
  error: message,
})
export type AgentVerb = (
  name: string,
  args: AgentSaid,
  caller: AgentCaller,
  deadline?: AbortSignal,
) => Promise<AgentAnswer>
export type AgentVerbs = Readonly<Record<string, AgentVerb>>
const verbLoads = new Set<() => Promise<AgentVerbs>>()
let verbsHeld: Promise<ReadonlyMap<string, AgentVerb>> | null = null
export function registerAgentVerbs(load: () => Promise<AgentVerbs>): () => void {
  verbLoads.add(load)
  verbsHeld = null
  return () => {
    if (verbLoads.delete(load)) verbsHeld = null
  }
}
async function verbsLoaded(): Promise<ReadonlyMap<string, AgentVerb>> {
  const held = (verbsHeld ??= (async () => {
    const tables = await Promise.all([...verbLoads].map((load) => load().catch(() => null)))
    if (tables.includes(null)) verbsHeld = null
    return new Map(tables.flatMap((table) => Object.entries(table ?? {})))
  })())
  return held
}
export const agentVerbNames = async (): Promise<string[]> => [...(await verbsLoaded()).keys()]
export async function runAgentVerb(
  name: string,
  args: AgentSaid,
  caller: AgentCaller,
  deadline?: AbortSignal,
): Promise<AgentAnswer> {
  const verb = (await verbsLoaded()).get(name)
  if (!verb) return agentRefusal('bad_arguments', `there is no verb called ${name}`)
  return verb(name, args, caller, deadline).catch((error: unknown) =>
    agentRefusal('failed', error instanceof Error ? error.message : String(error)),
  )
}
export interface AgentTabKind {
  readonly open?: (args: AgentSaid, caller: AgentCaller) => Promise<string | null>
  readonly list?: (args: AgentSaid, caller: AgentCaller) => Promise<AgentAnswer>
  readonly running?: (tab: string) => boolean
  readonly selection?: (tab: string, most: number) => Promise<unknown>
}
const NO_AGENT_TAB_KIND: AgentTabKind = {}
const tabKindLoads = new Map<string, () => Promise<AgentTabKind>>()
const tabKindsHeld = new Map<string, AgentTabKind>()
export function registerAgentTabKind(kind: string, load: () => Promise<AgentTabKind>): () => void {
  tabKindLoads.set(kind, load)
  tabKindsHeld.delete(kind)
  return () => {
    if (tabKindLoads.get(kind) !== load) return
    tabKindLoads.delete(kind)
    tabKindsHeld.delete(kind)
  }
}
export const agentTabKindParts = (kind: string): AgentTabKind => tabKindsHeld.get(kind) ?? NO_AGENT_TAB_KIND
export async function agentTabKindLoaded(kind: string): Promise<AgentTabKind> {
  const load = tabKindLoads.get(kind)
  if (!load) return NO_AGENT_TAB_KIND
  const held = tabKindsHeld.get(kind)
  if (held) return held
  const parts = await load().catch(() => null)
  if (!parts || tabKindLoads.get(kind) !== load) return NO_AGENT_TAB_KIND
  tabKindsHeld.set(kind, parts)
  return parts
}
