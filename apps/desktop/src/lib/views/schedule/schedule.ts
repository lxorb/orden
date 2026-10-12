/** The scheduler's arithmetic (docs/tasks.md, the Todoist round): the days it offers
 *  at the top, Todoist's Today, Tomorrow, Later this week, This weekend and Next week;
 *  how many open tasks each day already holds, which the calendar dots; what a typed
 *  phrase means, read with quick add's own grammar so a date typed here is a date typed
 *  there; the rules its Repeat offers for the day picked; and the change a pick makes
 *  to a task.
 *
 *  Pure. The layer that draws it is Scheduler.svelte. */

import { addDays, parseRule, type Row, ruleText, type TaskChange, weekday } from '@nib/bases'
import { parseQuickAdd } from '@nib/bases/language'

/** What a pick says about a task's day: null takes the field away, absent leaves it. */
export interface Scheduled {
  due: string | null
  time?: string | null
  /** How long it takes, in minutes. */
  minutes?: number | null
  recurrence?: string | null
}

export type QuickDay = 'today' | 'tomorrow' | 'later' | 'weekend' | 'next-weekend' | 'next-week'

/** The days the scheduler offers before its calendar, each with the day it means:
 *  today, tomorrow, two days on while that is still a weekday this side of Friday,
 *  the coming Saturday (next week's, once the weekend is here), and the coming Monday. */
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

/** How many open tasks each day already holds, by their due day (else scheduled). */
export function loadByDay(rows: readonly Row[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    const task = row.task
    if (!task || task.done || task.cancelled) continue
    const day = task.due ?? task.scheduled
    if (day) out.set(day, (out.get(day) ?? 0) + 1)
  }
  return out
}

/** What a phrase typed into the scheduler's field means: a day, a time, a repeat or a
 *  duration, every word of it read, or null while it is not all of one yet. */
export function typedWhen(text: string, langs: readonly string[], now: Date): Scheduled | null {
  const words = text.trim()
  if (!words) return null
  // A leading word that turns the grammar's day reading on is not needed here: the
  // field holds a date and nothing else. `x` stands in for the words a task would have.
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

/** A repeat for the day picked, in the Tasks plugin's own words: every week on that
 *  day, every month on that date, every year on it. */
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

/** Which preset a rule is, for the day it repeats from, or null for one of its own. */
export function repeatKindOf(rule: string | undefined, day: string): RepeatKind | null {
  if (rule === undefined) return null
  const read = parseRule(rule)
  if (!read) return null
  const written = ruleText(read)
  return REPEATS.find((kind) => repeatRule(kind, day) === written) ?? null
}

/** The task's date as a pick changes it. A task kept by its scheduled date (`⏳`) is
 *  moved by that date, so the plan it was written with stays; any other is given a due
 *  date (docs/tasks.md 8.2). No date takes the day, its time and its repeat away and
 *  leaves the duration, as Todoist does. */
export function changeFor(
  task: { due?: string | undefined; scheduled?: string | undefined } | null,
  picked: Scheduled,
): TaskChange {
  const byScheduled = task?.due === undefined && task?.scheduled !== undefined
  const field = byScheduled ? 'scheduled' : 'due'
  if (picked.due === null) {
    return {
      [field]: null,
      ...(byScheduled ? {} : task?.scheduled === undefined ? {} : { scheduled: null }),
      time: null,
      recurrence: null,
    }
  }
  const out: TaskChange = { [field]: picked.due }
  if (picked.time !== undefined) out.time = picked.time
  if (picked.minutes !== undefined) out.duration = picked.minutes
  if (picked.recurrence !== undefined) out.recurrence = picked.recurrence
  return out
}
