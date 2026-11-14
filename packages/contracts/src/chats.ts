export interface ChatNamesPort {
  readonly names: () => Promise<Readonly<Record<string, string>>>
}

export interface ChatPorts {
  readonly 'chats.names': ChatNamesPort
}
