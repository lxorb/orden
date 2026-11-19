import { isMuted } from '@orden/chats/notify'
import { samePath } from '../../platform/src/api'
import type { ChatEntry } from './shapes'

type Counted = Pick<ChatEntry, 'unread' | 'mutedUntil' | 'root'>
export const unreadCount = (entry: Counted, now: number): number => (isMuted(entry.mutedUntil, now) ? 0 : entry.unread)
export function unreadIn(list: readonly Counted[], root: string, now: number): number {
  return list.reduce(
    (sum, one) => (one.root !== null && samePath(one.root, root) ? sum + unreadCount(one, now) : sum),
    0,
  )
}
