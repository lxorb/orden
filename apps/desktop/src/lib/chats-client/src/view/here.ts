import { samePath } from '../../../platform/src/api'
import type { ChatEntry } from '../shapes'

export function chatsHere(chats: readonly ChatEntry[], root: string | null | undefined): ChatEntry[] {
  return root ? chats.filter((one) => samePath(one.root, root)) : []
}
export function holdsIn(chats: readonly ChatEntry[], root: string): boolean {
  return chatsHere(chats, root).length > 0
}
export function onlyHere<T extends { chat: string }>(found: readonly T[], here: readonly ChatEntry[]): T[] {
  return found.filter((one) => here.some((chat) => chat.id === one.chat))
}
