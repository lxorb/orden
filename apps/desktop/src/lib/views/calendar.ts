import {
  addDays,
  addMonths,
  daysInMonth,
  type Group,
  nextDate,
  parseRule,
  type Row,
} from '@orden/bases'
import { weekStart } from './days'
import { dayIn } from './values'

export type CalendarMode = 'month' | 'week' | 'days3' | 'day'
export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week', 'days3', 'day']

export function daysShown(mode: CalendarMode, anchor: string, first: number): string[] {
  if (mode === 'day') return [anchor]
  if (mode === 'days3') return [0, 1, 2].map((step) => addDays(anchor, step))
  if (mode === 'week') {
    const start = weekStart(anchor, first)
    return Array.from({ length: 7 }, (_, step) => addDays(start, step))
  }
  const month = `${anchor.slice(0, 8)}01`
  const start = weekStart(month, first)
  const last = `${anchor.slice(0, 8)}${String(daysInMonth(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)))).padStart(2, '0')}`
  const out: string[] = []
  for (let day = start; day <= last || out.length % 7 !== 0; day = addDays(day, 1)) out.push(day)
  return out
}

export function stepped(mode: CalendarMode, anchor: string, step: number): string {
  if (mode === 'month') return addMonths(anchor, step)
  if (mode === 'week') return addDays(anchor, 7 * step)
  if (mode === 'days3') return addDays(anchor, 3 * step)
  return addDays(anchor, step)
}

export interface Placed {
  row: Row
  day: string
  start?: number
  minutes?: number
  ghost?: boolean
}

function minutesOf(time: string): number | null {
  const found = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!found) return null
  return Number(found[1]) * 60 + Number(found[2])
}

export function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

const DEFAULT_MINUTES = 30

export function place(row: Row, day: string): Placed {
  const time = row.task?.time ? minutesOf(row.task.time) : null
  if (time === null) return { row, day }
  return { row, day, start: time, minutes: row.task?.duration ?? DEFAULT_MINUTES }
}

export function occurrences(placed: Placed, last: string, most = 62, first = placed.day): Placed[] {
  const task = placed.row.task
  if (!task?.recurrence || task.done || task.cancelled) return []
  const rule = parseRule(task.recurrence)
  if (!rule || rule.whenDone) return []
  const out: Placed[] = []
  const counted = rule.count !== undefined
  let left = counted ? (rule.count ?? 1) - 1 : Infinity
  let after = first > placed.day && !counted ? addDays(first, -1) : placed.day
  while (out.length < most && left > 0) {
    const next = nextDate(rule, placed.day, after)
    if (next === null || next > last) break
    if (next >= first) out.push({ ...placed, day: next, ghost: true })
    after = next
    left--
  }
  return out
}

export function placedByDay(
  rows: readonly Row[],
  days: readonly string[],
  dayOf: (row: Row) => string | null,
): { byDay: Map<string, Placed[]>; undated: Row[] } {
  const byDay = new Map<string, Placed[]>(days.map((day) => [day, []]))
  const undated: Row[] = []
  const first = days[0] ?? ''
  const last = days.at(-1) ?? ''
  for (const row of rows) {
    const day = dayOf(row)
    if (day === null) {
      undated.push(row)
      continue
    }
    const placed = place(row, day)
    if (day >= first) byDay.get(day)?.push(placed)
    for (const ghost of occurrences(placed, last, undefined, first)) {
      byDay.get(ghost.day)?.push(ghost)
    }
  }
  return { byDay, undated }
}

export function agendaOf(
  rows: readonly Row[],
  dayOf: (row: Row) => string | null,
): { dated: [string, Row[]][]; undated: Row[] } {
  const byDay = new Map<string, Row[]>()
  const undated: Row[] = []
  for (const row of rows) {
    const day = dayOf(row)
    if (day === null) undated.push(row)
    else byDay.set(day, [...(byDay.get(day) ?? []), row])
  }
  return { dated: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)), undated }
}

export function dayCounts(groups: readonly Group[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const group of groups) {
    const day = dayIn(group.key)
    if (day) out.set(day, group.rows.length)
  }
  return out
}
