const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const SNAPSHOT_MINUTES = [0, 1, 5, 15] as const

export const KEEP_DAYS = [1, 7, 30] as const

export const DEFAULT_MINUTES = 5
export const DEFAULT_DAYS = 7

export function snapshotMinutes(value: unknown): number {
  return SNAPSHOT_MINUTES.find((one) => one === value) ?? DEFAULT_MINUTES
}

export function keepDays(value: unknown): number {
  return KEEP_DAYS.find((one) => one === value) ?? DEFAULT_DAYS
}

export function staleSnapshots(
  taken: readonly number[],
  now: number,
  days: number = DEFAULT_DAYS,
): number[] {
  const stale: number[] = []
  const newestOfHour = new Map<number, number>()

  for (const at of [...taken].sort((a, b) => b - a)) {
    const age = now - at
    if (age > days * DAY) {
      stale.push(at)
      continue
    }
    if (age <= DAY) continue

    const hour = Math.floor(at / HOUR)
    if (newestOfHour.has(hour)) stale.push(at)
    else newestOfHour.set(hour, at)
  }

  return stale
}
