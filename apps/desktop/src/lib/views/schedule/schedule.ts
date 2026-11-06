import { addDays, parseRule, type Row, ruleText, type TaskChange, weekday } from '@orden/bases'
import { parseQuickAdd } from '@orden/bases/language'
import { dayOf, type DueReads, startField, startOf } from '@orden/markdown/task-dates'

export interface Scheduled {
  due: string | null
  time?: string | null
  minutes?: number | null
  recurrence?: string | null
}

export type QuickDay = 'today' | 'tomorrow' | 'later' | 'weekend' | 'next-weekend' | 'next-week'

export function quickDays(today: string): { kind: QuickDay; day: string }[] {
  const now = weekday(today)
  const out: { kind: QuickDay; day: string }[] = [
    { kind: 'today', day: today },
    { kind: 'tomorrow', day: addDays(today, 1) },
  ]
  if (now >= 1 && now <= 3) out.push({ kind: 'later', day: addDays(today, 2) })
  if (now === 0 || now === 6) {
    out.push({ kind: 'next-weekend', day: addDays(today, now === 6 ? 7 : 6) })
  } else {
    out.push({ kind: 'weekend', day: addDays(today, 6 - now) })
  }
  out.push({ kind: 'next-week', day: addDays(today, (8 - now) % 7 || 7) })
  return out
}

export function loadByDay(rows: readonly Row[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    const task = row.task
    if (!task || task.done || task.cancelled) continue
    const day = dayOf(task, task.dueReads)
    if (day) out.set(day, (out.get(day) ?? 0) + 1)
  }
  return out
}

export function typedWhen(text: string, langs: readonly string[], now: Date): Scheduled | null {
  const words = text.trim()
  if (!words) return null
  const read = parseQuickAdd(`x ${words}`, langs, now)
  if (read.text !== 'x') return null
  const fields = read.fields
  if (fields.due === undefined && fields.time === undefined && fields.recurrence === undefined) {
    return null
  }
  return {
    due: fields.due ?? null,
    ...(fields.time === undefined ? {} : { time: fields.time }),
    ...(fields.recurrence === undefined ? {} : { recurrence: fields.recurrence }),
    ...(fields.duration === undefined ? {} : { minutes: fields.duration }),
  }
}

export type RepeatKind = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly'
export const REPEATS: readonly RepeatKind[] = ['daily', 'weekly', 'weekdays', 'monthly', 'yearly']

export function repeatRule(kind: RepeatKind, day: string): string {
  const date = Number(day.slice(8, 10))
  const month = Number(day.slice(5, 7))
  switch (kind) {
    case 'daily':
      return 'every day'
    case 'weekdays':
      return 'every weekday'
    case 'weekly':
      return ruleText({
        every: 1,
        unit: 'week',
        weekdays: [{ day: weekday(day) }],
        monthDays: [],
        months: [],
        whenDone: false,
      })
    case 'monthly':
      return ruleText({
        every: 1,
        unit: 'month',
        weekdays: [],
        monthDays: [date],
        months: [],
        whenDone: false,
      })
    case 'yearly':
      return ruleText({
        every: 1,
        unit: 'year',
        weekdays: [],
        monthDays: [date],
        months: [month],
        whenDone: false,
      })
  }
}

export function repeatKindOf(rule: string | undefined, day: string): RepeatKind | null {
  if (rule === undefined) return null
  const read = parseRule(rule)
  if (!read) return null
  const written = ruleText(read)
  return REPEATS.find((kind) => repeatRule(kind, day) === written) ?? null
}

interface Dated {
  due?: string | undefined
  scheduled?: string | undefined
  start?: string | undefined
  deadline?: string | undefined
  dueReads?: DueReads | undefined
}

export function changeFor(task: Dated | null, picked: Scheduled): TaskChange {
  const reads = task?.dueReads ?? 'start'
  const field = task ? startField(task, reads) : 'start'
  if (picked.due === null) {
    if (task && (startOf(task, reads) ?? task.scheduled) === undefined) return {}
    const out: TaskChange = { [field]: null, time: null, recurrence: null }
    if (task?.start !== undefined) out.start = null
    if (task?.scheduled !== undefined) out.scheduled = null
    if (reads === 'start' && task?.due !== undefined) out.due = null
    return out
  }
  const out: TaskChange = { [field]: picked.due }
  if (picked.time !== undefined) out.time = picked.time
  if (picked.minutes !== undefined) out.duration = picked.minutes
  if (picked.recurrence !== undefined) out.recurrence = picked.recurrence
  return out
}
