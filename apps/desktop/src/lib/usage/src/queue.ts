import { daysBetween, MOST_USAGE_EVENTS, USAGE_DAYS_KEPT, type UsageEvent } from '@orden/sync-core'
import { ApiError } from '../../accounts/src/api'

export const MOST_QUEUED = 2 * (USAGE_DAYS_KEPT + 1)
export function pruned(queue: readonly UsageEvent[], today: string, helping: boolean): UsageEvent[] {
  if (!helping) return []
  return queue.filter((one) => daysBetween(one.day, today) <= USAGE_DAYS_KEPT).slice(-MOST_QUEUED)
}
export function sendable(build: { release: boolean; held: boolean }): boolean {
  return build.release && !build.held
}
export interface Flushing {
  queue(): UsageEvent[]
  keepQueue(events: UsageEvent[]): void
  post(events: UsageEvent[]): Promise<unknown>
}
export type Flushed = 'done' | 'later' | 'empty'
export async function flush(how: Flushing): Promise<Flushed> {
  const waiting = how.queue()
  if (waiting.length === 0) return 'empty'
  for (let at = 0; at < waiting.length; at += MOST_USAGE_EVENTS) {
    const events = waiting.slice(at, at + MOST_USAGE_EVENTS)
    try {
      await how.post(events)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400)) {
        how.keepQueue(waiting.slice(at))
        return 'later'
      }
    }
  }
  how.keepQueue([])
  return 'done'
}
