import type { Who } from '@orden/chats'
import type { Item } from './rows'

const AT_BOTTOM = 4
const GLIDE_SCREENS = 3
export function atBottom(box: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - AT_BOTTOM
}
export function glides(distance: number, room: number): boolean {
  return distance > 0 && distance <= room * GLIDE_SCREENS
}
export function ownSent(before: readonly Item[], after: readonly Item[], me: Who | null): string | null {
  if (me === null) return null
  const known = new Set<string>()
  for (const item of before) if (item.kind === 'message' && item.pending) known.add(item.key)
  for (let at = after.length - 1; at >= 0; at--) {
    const item = after[at]
    if (item?.kind !== 'message' || !item.pending) return null
    if (item.message.author === me && !known.has(item.key)) return item.key
  }
  return null
}
