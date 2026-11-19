import { midnightOf } from '../../platform/src/api'
import type { Visit } from '@orden/scan/visits'

export type HistoryRow = { kind: 'day'; key: string; day: number } | { kind: 'visit'; key: string; visit: Visit }
const wordsOf = (typed: string) => typed.toLowerCase().split(/\s+/).filter(Boolean)
function holds(visit: Visit, words: readonly string[]): boolean {
  if (!words.length) return true
  const said = `${visit.title} ${visit.url}`.toLowerCase()
  return words.every((word) => said.includes(word))
}
export function answers(visit: Visit, typed: string): boolean {
  return holds(visit, wordsOf(typed))
}
export function historyRows(list: readonly Visit[], typed: string): HistoryRow[] {
  const words = wordsOf(typed)
  const found = list.filter((one) => holds(one, words)).sort((one, other) => other.last - one.last)
  const rows: HistoryRow[] = []
  let day = Number.NaN
  for (const visit of found) {
    const its = midnightOf(visit.last)
    if (its !== day) {
      day = its
      rows.push({ kind: 'day', key: `day:${String(its)}`, day: its })
    }
    rows.push({ kind: 'visit', key: visit.url, visit })
  }
  return rows
}
export function dayName(day: number, now: number, locale: string, words: { today: string; yesterday: string }): string {
  const today = midnightOf(now)
  if (day === today) return words.today
  if (day === midnightOf(today - 1)) return words.yesterday
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: new Date(day).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  }).format(day)
}
export function onScreen(
  scrolled: number,
  height: number,
  rowHeight: number,
  count: number,
  spare = 8,
): { from: number; to: number } {
  const from = Math.max(0, Math.floor(scrolled / rowHeight) - spare)
  const to = Math.min(count, Math.ceil((scrolled + height) / rowHeight) + spare)
  return { from, to: Math.max(from, to) }
}
