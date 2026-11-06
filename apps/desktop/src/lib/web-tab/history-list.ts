import { readable } from './address'
import type { Visit } from './visits'

export type HistoryRow =
  { kind: 'day'; key: string; day: number } | { kind: 'visit'; key: string; visit: Visit }

export function dayOf(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function hostOf(url: string): string {
  try {
    return readable(new URL(url).host).replace(/^www\./i, '')
  } catch {
    return url
  }
}

export function answers(visit: Visit, typed: string): boolean {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true

  const said = `${visit.title} ${visit.url}`.toLowerCase()
  return words.every((word) => said.includes(word))
}

export function historyRows(list: readonly Visit[], typed: string): HistoryRow[] {
  const found = list
    .filter((one) => answers(one, typed))
    .sort((one, other) => other.last - one.last)

  const rows: HistoryRow[] = []
  let day = Number.NaN
  for (const visit of found) {
    const its = dayOf(visit.last)
    if (its !== day) {
      day = its
      rows.push({ kind: 'day', key: `day:${String(its)}`, day: its })
    }
    rows.push({ kind: 'visit', key: visit.url, visit })
  }
  return rows
}

export function dayName(
  day: number,
  now: number,
  locale: string,
  words: { today: string; yesterday: string },
): string {
  const today = dayOf(now)
  if (day === today) return words.today
  if (day === dayOf(today - 1)) return words.yesterday

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
