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
export interface ChatsDemoPicture {
  readonly width: number
  readonly height: number
  readonly name?: string
  readonly caption?: string
}
export interface ChatsDemo {
  add(folder: string, name: string, members: readonly ChatsDemoPerson[]): string
  say(path: string, from: string, body: string): string | null
  picture(path: string, from: string, url: string, size: ChatsDemoPicture): string | null
  react(path: string, message: string, who: string, emoji: string): void
  typing(path: string, who: string, on: boolean): void
  open(path: string, how?: OpenHow): void
}
export interface ChatsDemoPort {
  stage(me: ChatsDemoPerson): Promise<ChatsDemo>
}
export interface ChatPlace {
  readonly root: string
  readonly path: string
}
export interface ChatPlacesHeard {
  seen(root: string | null, paths: readonly string[]): void
  moved(from: string | null, to: string | null): void
  folderMoved(from: string, to: string): void
  lookAgain(): void
}
export interface ChatPlaces {
  rootHolding(path: string): string | null
  rootOf(space: string): string | null
  remoteOf(root: string): string | null
  noteId(path: string): string | null
  nudge(): void
  retired(chat: string): boolean
  find(
    rank: (chat: string, place: ChatPlace) => number,
    unread: (root: string) => void,
  ): Promise<Map<string, ChatPlace>>
  read(path: string): Promise<string | null>
  make(folder: string, name: string): Promise<ChatPlace | null>
  under(path: string): Promise<string[]>
  follow(heard: ChatPlacesHeard): void
}
export interface ChatPlacesPort {
  load(): Promise<ChatPlaces>
}
export interface ChatPorts {
  readonly chats: ChatsPort
  readonly 'chats.demo': ChatsDemoPort
  readonly 'chats.places': ChatPlacesPort
}
export async function chatsEnding(paths: readonly string[]): Promise<() => void> {
  const chats = portOf('chats')
  return chats.ok && chats.value.ending ? chats.value.ending(paths) : () => undefined
}
