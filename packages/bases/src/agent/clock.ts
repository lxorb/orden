import type { Context } from '../types'

function partsOf(now: Date, zone?: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      ...(zone ? { timeZone: zone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
}

export function clockOf(now: Date, zone?: string): Pick<Context, 'today' | 'now'> {
  const parts = partsOf(now, zone)
  const today = `${parts.year}-${parts.month}-${parts.day}`
  return { today, now: `${today}T${parts.hour}:${parts.minute}:${parts.second}` }
}

export function wallClock(now: Date, zone?: string): Date {
  if (!zone) return now
  const parts = partsOf(now, zone)
  const at = (key: string) => Number(parts[key])
  return new Date(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
    now.getMilliseconds(),
  )
}
