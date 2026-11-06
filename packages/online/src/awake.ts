import type { Activity, Allowance, AwakeAnswer, Watcher } from './types'

export const IDLE_MS = 15 * 60 * 1000

export const ACTIVITY_EVERY_MS = 30 * 1000

const BUSY_CPU = 0.05

const BUSY_NET_PER_MINUTE = 50 * 1024

export const OFF: Allowance = { awakeS: 0, cpuS: 0, homeBytes: 0, egressBytes: 0 }

function working(activity: Activity): boolean {
  const netPerMinute = (activity.net * 60_000) / ACTIVITY_EVERY_MS
  return activity.output > 0 || activity.cpu > BUSY_CPU || netPerMinute > BUSY_NET_PER_MINUTE
}

function spent(used: Allowance, limit: Allowance): boolean {
  return (
    used.awakeS >= limit.awakeS || used.cpuS >= limit.cpuS || used.egressBytes >= limit.egressBytes
  )
}

export function awake(
  now: number,
  watchers: readonly Watcher[],
  recent: readonly Activity[],
  keepAwake: boolean,
  used: Allowance,
  limit: Allowance,
  budgetLeft: number,
): AwakeAnswer {
  if (limit.awakeS <= 0) return { stay: false, reason: 'off' }
  if (!(budgetLeft > 0)) return { stay: false, reason: 'budget' }
  if (spent(used, limit)) return { stay: false, reason: 'allowance' }

  if (keepAwake) return { stay: true }
  if (watchers.some((watcher) => watcher.active && watcher.onScreen)) return { stay: true }
  if (recent.some((activity) => now - activity.at <= IDLE_MS && working(activity))) {
    return { stay: true }
  }
  return { stay: false, reason: 'idle' }
}
