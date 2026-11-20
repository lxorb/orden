import { portOf } from './ports'
import type { OpenHow } from './tab-kinds'

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
  openLink(uri: string, how?: OpenHow): Promise<void>
  mayDelete(paths: readonly string[]): Promise<boolean>
  ending?(paths: readonly string[]): Promise<() => void>
}
export interface ChatsDemoPerson {
  readonly id: string
  readonly name: string
}
export interface ChatsDemo {
  add(folder: string, name: string, members: readonly ChatsDemoPerson[]): string
  say(path: string, from: string, body: string): void
  typing(path: string, who: string, on: boolean): void
  open(path: string, how?: OpenHow): void
}
export interface ChatsDemoPort {
  stage(me: ChatsDemoPerson): Promise<ChatsDemo>
}
export interface ChatPorts {
  readonly chats: ChatsPort
  readonly 'chats.demo': ChatsDemoPort
}
export async function chatsEnding(paths: readonly string[]): Promise<() => void> {
  const chats = portOf('chats')
  return chats.ok && chats.value.ending ? chats.value.ending(paths) : () => undefined
}
