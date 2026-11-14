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

export interface AgentPorts {
  readonly 'agents.writes': AgentWritesPort
}
