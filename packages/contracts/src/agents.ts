export interface AgentWritesPort {
  wrote(agent: string, tabs: readonly string[]): void
}

export interface AgentPorts {
  readonly 'agents.writes': AgentWritesPort
}
