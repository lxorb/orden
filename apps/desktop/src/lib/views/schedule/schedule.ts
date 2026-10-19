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
import { dayOf, type DueReads, startField } from '@nib/markdown/task-dates'

/** What a pick says about a task's day: null takes the field away, absent leaves it.
 *  `due` is the day picked, which is the day the task starts (#371). */
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

/** How many open tasks each day already holds, by the day each is on. */
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

/** A task, as far as which of its dates a pick lands on goes. */
interface Dated {
  due?: string | undefined
  scheduled?: string | undefined
  start?: string | undefined
  deadline?: string | undefined
  dueReads?: DueReads | undefined
}

/** The task's start date as a pick changes it (#371): written to the field that already
 *  holds its day - `🛫`, a `⏳` it is kept by, an old `📅` in a space of nib's own - so
 *  nothing else on the line moves, else as a new `🛫`. No date takes the day, its time
 *  and its repeat away and leaves the duration and the deadline, as Todoist does. */
export function changeFor(task: Dated | null, picked: Scheduled): TaskChange {
  const reads = task?.dueReads ?? 'start'
  const field = task ? startField(task, reads) : 'start'
  if (picked.due === null) {
    const out: TaskChange = { [field]: null, time: null, recurrence: null }
    // Whatever would be read as its start once that is gone, goes with it.
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
