import type { TimeRange } from '@orden/contracts'
import { dayOf, midnightOf } from '../../../platform/src/api'

export type StatsRange = TimeRange
export const dayIso = (day: number): string => dayOf(day)
export function isoDay(iso: string): number | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!found) return null
  const at = new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3]))
  return Number.isNaN(at.getTime()) ? null : midnightOf(at.getTime())
}
export function withinRange(
  range: Extract<TimeRange, { kind: 'custom' }>,
  moved: 'from' | 'to',
  today: number,
): Extract<TimeRange, { kind: 'custom' }> {
  const from = Math.min(range.from, today)
  const to = Math.min(range.to, today)
  if (from <= to) return { kind: 'custom', from, to }
  return moved === 'from' ? { kind: 'custom', from, to: from } : { kind: 'custom', from: to, to }
}
