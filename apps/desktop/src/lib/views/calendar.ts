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

interface Walk {
  days: string[]
  ended: boolean
}

const walks = new Map<string, Walk>()

const WALKS_KEPT = 512

function countedDays(
  rule: NonNullable<ReturnType<typeof parseRule>>,
  key: string,
  start: string,
  last: string,
): string[] {
  let walk = walks.get(key)
  if (!walk) {
    walk = { days: [], ended: false }
    walks.set(key, walk)
    if (walks.size > WALKS_KEPT) walks.delete(walks.keys().next().value ?? key)
  }
  const most = (rule.count ?? 1) - 1
  while (!walk.ended && (walk.days.at(-1) ?? start) < last) {
    const next = walk.days.length < most ? nextDate(rule, start, walk.days.at(-1) ?? start) : null
    if (next === null) walk.ended = true
    else walk.days.push(next)
  }
  return walk.days
}

function firstAtOrAfter(days: readonly string[], day: string): number {
  let low = 0
  let high = days.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((days[middle] ?? '') < day) low = middle + 1
    else high = middle
  }
  return low
}

export function occurrences(placed: Placed, last: string, most = 62, first = placed.day): Placed[] {
  const task = placed.row.task
  if (!task?.recurrence || task.done || task.cancelled) return []
  const rule = parseRule(task.recurrence)
  if (!rule || rule.whenDone) return []
  const out: Placed[] = []
  if (rule.count !== undefined) {
    const days = countedDays(rule, `${task.recurrence}\n${placed.day}`, placed.day, last)
    for (let at = firstAtOrAfter(days, first); at < days.length && out.length < most; at++) {
      const day = days[at] ?? last
      if (day > last) break
      out.push({ ...placed, day, ghost: true })
    }
    return out
  }
  let after = first > placed.day ? addDays(first, -1) : placed.day
  while (out.length < most) {
    const next = nextDate(rule, placed.day, after)
    if (next === null || next > last) break
    if (next >= first) out.push({ ...placed, day: next, ghost: true })
    after = next
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
    else {
      const gathered = byDay.get(day)
      if (gathered) gathered.push(row)
      else byDay.set(day, [row])
    }
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
