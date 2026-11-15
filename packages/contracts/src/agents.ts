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
  | 'applications'

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
  heard(
    id: string,
    patience: number,
    signal: AbortSignal,
  ): Promise<{ answer: string | null } | null>
  hear(on: (heard: AgentHeard) => void): Promise<() => void>
}

export interface AgentMarksPort {
  keepMarksOf(agents: ReadonlySet<string>): void
}

export interface AgentPorts {
  readonly 'agents.writes': AgentWritesPort
  readonly 'agents.reader': AgentReaderPort
  readonly 'agents.marks': AgentMarksPort
}
