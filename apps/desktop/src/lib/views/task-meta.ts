/** What a task row says under its words, Todoist's way: the line of meta after the
 *  description - its day in the colour of how near it is, its time, ↻ for a repeat, the
 *  deadline, the duration, a bell for a reminder, how many of its sub-tasks are done,
 *  how many comments it has, its labels and its assignee - and how many lines the row
 *  takes, which is what the list is laid out by (`Heights` in chats/view/window.ts).
 *
 *  Pure, and in its own file because the row, the board's card and the list's
 *  arithmetic all ask it the same question and have to get one answer. */

import { dayNumber, type Row, type TaskRow } from '@nib/bases'
import { dayWords, timeWords } from '@nib/editor/task-days'

/** How near a day is, which is the colour its words are drawn in: Todoist's red for
 *  a day gone by, green for today, orange for tomorrow, purple for the rest of the
 *  week, and the row's own ink after that. */
export type DayTone = 'late' | 'today' | 'tomorrow' | 'week' | 'later'

export function dayTone(day: string, today: string): DayTone {
  const ahead = dayNumber(day) - dayNumber(today)
  if (ahead < 0) return 'late'
  if (ahead === 0) return 'today'
  if (ahead === 1) return 'tomorrow'
  if (ahead < 7) return 'week'
  return 'later'
}

/** One thing the meta line says. */
export type Meta =
  | { kind: 'date'; text: string; tone: DayTone; repeat: boolean }
  | { kind: 'deadline'; text: string; late: boolean }
  | { kind: 'duration'; minutes: number }
  | { kind: 'remind' }
  | { kind: 'subtasks'; done: number; total: number }
  | { kind: 'comments'; count: number }
  | { kind: 'tag'; tag: string }
  | { kind: 'assignee'; name: string }

/** How many of a task's own sub-tasks there are and how many are done. */
export interface Subtasks {
  done: number
  total: number
}

/** The key a task is known by among the rows of every space: its space, its note and
 *  its line, which is what a sub-task's `parent` names. */
export function taskKey(space: string, path: string, line: number): string {
  return `${space}\n${path}#${line}`
}

/** Every task's direct sub-tasks, counted, over all the rows a view is over: one pass,
 *  asked again only when the rows change. A view that shows a parent without its
 *  sub-tasks (Today holds a dated parent and not its undated steps) still says 1/3. */
export function subtaskCounts(rows: readonly Row[]): Map<string, Subtasks> {
  const out = new Map<string, Subtasks>()
  for (const row of rows) {
    const task = row.task
    if (task?.parent === undefined || task.cancelled) continue
    const key = taskKey(row.space, row.path, task.parent)
    const counted = out.get(key) ?? { done: 0, total: 0 }
    counted.total++
    if (task.done) counted.done++
    out.set(key, counted)
  }
  return out
}

/** The meta line of a task, in the order Todoist draws it. `dated` false leaves the
 *  day off, for a view whose groups already are the days. */
export function metaOf(
  task: TaskRow,
  today: string,
  dated: boolean,
  subtasks: Subtasks | undefined,
): Meta[] {
  const out: Meta[] = []
  const open = !task.done && !task.cancelled
  const day = task.due ?? task.scheduled
  if (dated && day) {
    out.push({
      kind: 'date',
      text: dayWords(day, today, task.time),
      tone: open ? dayTone(day, today) : 'later',
      repeat: task.recurrence !== undefined,
    })
  } else if (task.recurrence !== undefined || (!dated && task.time)) {
    // A day the group already says still has its time and its repeat to say.
    out.push({
      kind: 'date',
      text: task.time ? timeWords(task.time) : '',
      tone: 'later',
      repeat: task.recurrence !== undefined,
    })
  }
  if (task.deadline) {
    out.push({
      kind: 'deadline',
      text: dayWords(task.deadline, today),
      late: open && task.deadline <= today,
    })
  }
  if (task.duration !== undefined) out.push({ kind: 'duration', minutes: task.duration })
  if (task.remind.length) out.push({ kind: 'remind' })
  if (subtasks?.total) out.push({ kind: 'subtasks', ...subtasks })
  if (task.comments) out.push({ kind: 'comments', count: task.comments })
  for (const tag of task.tags) out.push({ kind: 'tag', tag })
  if (task.assignee) out.push({ kind: 'assignee', name: task.assignee })
  return out
}

/** Whether a task has anything to say on its meta line: what `metaOf` would answer
 *  something for, asked without writing a word of it, because the list asks it of every
 *  row it holds and only draws the ones on screen. */
export function hasMeta(task: TaskRow, dated: boolean, subtasks: Subtasks | undefined): boolean {
  return (
    (dated && (task.due ?? task.scheduled) !== undefined) ||
    task.recurrence !== undefined ||
    (!dated && task.time !== undefined) ||
    task.deadline !== undefined ||
    task.duration !== undefined ||
    task.remind.length > 0 ||
    (subtasks?.total ?? 0) > 0 ||
    (task.comments ?? 0) > 0 ||
    task.tags.length > 0 ||
    task.assignee !== undefined
  )
}

/** How many lines a task row is: its words, its description where it has one, and the
 *  meta line where there is something to say on it - which a view that names each
 *  task's note always has. */
export function lineCount(task: TaskRow, meta: boolean, where: boolean): number {
  return 1 + (task.description ? 1 : 0) + (meta || where ? 1 : 0)
}
