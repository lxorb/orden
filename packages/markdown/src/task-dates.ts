/** What a task's dates mean (#371).
 *
 *  A task has two dates a reader sets: its **start date**, the first day it can be
 *  worked on, and its **deadline**, the day it has to be done by. Before its start date
 *  a task is out of sight; from then on it is simply there, and nothing under it says
 *  when it started. Only a deadline is said under a task, and only a deadline makes one
 *  overdue.
 *
 *  Written, a start date is `🛫` (the Tasks plugin's start) and a deadline is
 *  `[deadline:: ]`. A `📅` is read by where it stands, and never rewritten:
 *
 *  - in an Obsidian vault - a space with `.obsidian` at its root - `📅` is the Tasks
 *    plugin's due date, which is a deadline: said under the task, and overdue once past;
 *  - in a space of nib's own, where a deadline has always been `[deadline:: ]`, a `📅`
 *    is the date nib wrote before it said start dates, and is read as one - unless the
 *    line has a `🛫` of its own, which makes it a line written the plugin's way, start
 *    and due, and its `📅` the deadline.
 *
 *  `⏳` stays the Tasks plugin's scheduled date, the day a task is meant to be done on:
 *  it places a task on a day the way a start date does, and never makes it overdue.
 *
 *  Pure: the fields in, the dates out. Where a date is written back is here too, so an
 *  edit lands on the field that already holds it and a file is only ever changed where
 *  the reader changed it. */

/** What a `📅` means in a space: a start date, or the Tasks plugin's due date, which is a
 *  deadline. */
export type DueReads = 'start' | 'deadline'

/** A task, as far as its dates go. */
interface Dated {
  due?: string | undefined
  scheduled?: string | undefined
  start?: string | undefined
  deadline?: string | undefined
}

/** A task's start date, as its space reads its fields. */
export function startOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return task.start ?? (due === 'start' ? task.due : undefined)
}

/** A task's deadline, as its space reads its fields. */
export function deadlineOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return task.deadline ?? (dueIsDeadline(task, due) ? task.due : undefined)
}

/** Whether a `📅` on this task is its deadline: in a vault, and beside a `🛫`. */
function dueIsDeadline(task: Dated, due: DueReads): boolean {
  return due === 'deadline' || task.start !== undefined
}

/** The day a task is placed on - in Today, in Upcoming, on a calendar: the day it starts
 *  or is scheduled for, else the day it is due. */
export function dayOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return startOf(task, due) ?? task.scheduled ?? deadlineOf(task, due)
}

/** Whether a task can be worked on by `today`: it has no start date, or that has come. */
export function hasStarted(task: Dated, today: string, due: DueReads = 'start'): boolean {
  const start = startOf(task, due)
  return start === undefined || start <= today
}

/** Whether a task's deadline has passed by `today`. Only a deadline makes a task late. */
export function isLate(task: Dated, today: string, due: DueReads = 'start'): boolean {
  const deadline = deadlineOf(task, due)
  return deadline !== undefined && deadline < today
}

/** The field a start date set on this task is written to: the one already holding its
 *  day, in the order `dayOf` reads them - `🛫`, a `📅` read as a start, `⏳` - else a new
 *  `🛫`. */
export function startField(task: Dated, due: DueReads = 'start'): 'start' | 'scheduled' | 'due' {
  if (task.start) return 'start'
  if (due === 'start' && task.due) return 'due'
  if (task.scheduled) return 'scheduled'
  return 'start'
}

/** The field a deadline set on this task is written to: a vault's `📅` where that is what
 *  holds it, else `[deadline:: ]`. */
export function deadlineField(task: Dated, due: DueReads = 'start'): 'deadline' | 'due' {
  if (!task.deadline && task.due && dueIsDeadline(task, due)) return 'due'
  return 'deadline'
}
