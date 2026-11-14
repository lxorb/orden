export type ChatPartWanted = 'unread' | 'unread-or-newest'

export interface ChatPart {
  readonly label: string
  readonly text: string
}

export interface ChatListed {
  readonly id: string
  readonly name: string | null
  readonly unread: number
  readonly mentions: number
}

export interface ChatsPort {
  list(): Promise<readonly ChatListed[]>
  chatAt(path: string): Promise<string | null>
  part(chat: string, wanted: ChatPartWanted): Promise<ChatPart | null>
  offer(chat: string, text: string, parent?: string): Promise<void>
}

export interface ChatPorts {
  readonly chats: ChatsPort
}
