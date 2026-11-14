export type Clears = '30m' | '1h' | '4h' | 'today' | 'week' | 'never'

export const CLEARS: readonly Clears[] = ['30m', '1h', '4h', 'today', 'week', 'never']

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export function clearsAt(choice: Clears, now: Date): number | null {
  switch (choice) {
    case '30m':
      return now.getTime() + 30 * MINUTE
    case '1h':
      return now.getTime() + HOUR
    case '4h':
      return now.getTime() + 4 * HOUR
    case 'today':
      return midnightAfter(now, 0)
    case 'week':
      return midnightAfter(now, (7 - now.getDay()) % 7)
    case 'never':
      return null
  }
}

function midnightAfter(now: Date, days: number): number {
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  end.setDate(end.getDate() + days)
  return end.getTime()
}

export function stands(status: { until: number | null } | null | undefined, now: number): boolean {
  return !!status && (status.until === null || status.until > now)
}
