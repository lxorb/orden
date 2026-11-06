import type { Notify } from '@orden/chats'
import { isMuted, levelOf, MUTED_FOR_GOOD } from '@orden/chats/notify'

const HOUR = 60 * 60 * 1000

export const MUTE_HOURS = [1, 8, 24, 7 * 24] as const

export type Ring = 'all' | 'mentions' | 'off'

export function ringOf(
  notify: Notify | null,
  mutedUntil: number | null,
  members: number,
  now: number,
): Ring {
  if (isMuted(mutedUntil, now)) return 'off'
  const level = levelOf(notify, members)
  return level === 'nothing' ? 'off' : level
}

export function mutedUntil(hours: number | null, now: number): number {
  return hours === null ? MUTED_FOR_GOOD : now + hours * HOUR
}
