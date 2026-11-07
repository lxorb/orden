import { TIME_ID, TIME_KIND } from '@orden/sync-core/time'
import { isRecord } from '../stored'
import type { Activity, Span } from './records'

const HEAD = ['start', 'end', 'minutes', 'activity', 'tags', 'note', 'source', 'place']

function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function csvOf(
  spans: readonly Span[],
  activities: readonly Activity[],
  now: number,
): string {
  const named = new Map(activities.map((one) => [one.id, one.name]))
  const rows = spans.map((span) => {
    const end = span.end ?? now
    return [
      new Date(span.start).toISOString(),
      span.end === null ? '' : new Date(span.end).toISOString(),
      String(Math.round((end - span.start) / 60_000)),
      span.activity ? (named.get(span.activity) ?? '') : '',
      span.tags.join(', '),
      span.note,
      span.source,
      span.label ?? span.place ?? '',
    ]
  })
  return [HEAD, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

const TIME_FORMAT = 'orden-time'

export interface TimeRecord {
  kind: string
  id: string
  value: Record<string, unknown>
}

export function jsonOf(records: readonly TimeRecord[]): string {
  return `${JSON.stringify({ format: TIME_FORMAT, version: 1, records }, null, 2)}\n`
}

export function recordsIn(text: string): TimeRecord[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.format !== TIME_FORMAT || !Array.isArray(parsed.records)) {
    return null
  }
  return (parsed.records as unknown[]).flatMap((one) =>
    isRecord(one) &&
    typeof one.kind === 'string' &&
    TIME_KIND.test(one.kind) &&
    typeof one.id === 'string' &&
    TIME_ID.test(one.id) &&
    isRecord(one.value)
      ? [{ kind: one.kind, id: one.id, value: one.value }]
      : [],
  )
}
