import {
  daysBetween,
  MOST_USAGE_EVENTS,
  USAGE_DAYS_KEPT,
  type UsageEvent,
} from '@orden/sync-core/usage'
import { ApiError } from '../api'

export const MOST_QUEUED = 2 * (USAGE_DAYS_KEPT + 1)

export function pruned(
  queue: readonly UsageEvent[],
  today: string,
  helping: boolean,
): UsageEvent[] {
  return queue
    .filter((one) => daysBetween(one.day, today) <= USAGE_DAYS_KEPT)
    .filter((one) => (one.kind === 'daily' ? true : helping))
    .slice(-MOST_QUEUED)
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
