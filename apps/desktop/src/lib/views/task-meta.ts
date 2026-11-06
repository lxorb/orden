import { dayNumber, INBOX_PATH, type Row, type TaskRow } from '@orden/bases'
import { dayWords, timeWords } from '@orden/editor/task-days'
import { deadlineOf, startOf } from '@orden/markdown/task-dates'
import { ACCENTS, accentColour, DEFAULT_ACCENT } from '../accents'

export type DayTone = 'late' | 'today' | 'tomorrow' | 'week' | 'later'

export function dayTone(day: string, today: string): DayTone {
  const ahead = dayNumber(day) - dayNumber(today)
  if (ahead < 0) return 'late'
  if (ahead === 0) return 'today'
  if (ahead === 1) return 'tomorrow'
  if (ahead < 7) return 'week'
  return 'later'
}

export type Meta =
  | { kind: 'date'; text: string; tone: DayTone; repeat: boolean }
  | { kind: 'deadline'; text: string; late: boolean; repeat: boolean }
  | { kind: 'duration'; minutes: number }
  | { kind: 'remind' }
  | { kind: 'subtasks'; done: number; total: number }
  | { kind: 'comments'; count: number }
  | { kind: 'tag'; tag: string }
  | { kind: 'assignee'; name: string }

export interface Subtasks {
  done: number
  total: number
}

export function taskKey(space: string, path: string, line: number): string {
  return `${space}\n${path}#${line}`
}

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

export function labelsOf(rows: readonly Row[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) for (const tag of row.task?.tags ?? []) seen.add(tag)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export function metaOf(
  task: TaskRow,
  today: string,
  dated: boolean,
  subtasks: Subtasks | undefined,
): Meta[] {
  const out: Meta[] = []
  const open = !task.done && !task.cancelled
  const day = ahead(task, today)
  const deadline = deadlineOf(task, task.dueReads)
  let repeat = task.recurrence !== undefined
  if (dated && day) {
    out.push({
      kind: 'date',
      text: dayWords(day, today, task.time),
      tone: open ? dayTone(day, today) : 'later',
      repeat,
    })
    repeat = false
  } else if (task.time || (repeat && !deadline)) {
    out.push({
      kind: 'date',
      text: task.time ? timeWords(task.time) : '',
      tone: 'later',
      repeat: repeat && !deadline,
    })
    if (!deadline) repeat = false
  }
  if (deadline) {
    out.push({
      kind: 'deadline',
      text: dayWords(deadline, today),
      late: open && deadline <= today,
      repeat,
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

function ahead(task: TaskRow, today: string): string | undefined {
  const day = startOf(task, task.dueReads) ?? task.scheduled
  return day !== undefined && day > today ? day : undefined
}

export function hasMeta(
  task: TaskRow,
  dated: boolean,
  subtasks: Subtasks | undefined,
  today: string,
): boolean {
  return (
    (dated && ahead(task, today) !== undefined) ||
    task.recurrence !== undefined ||
    task.time !== undefined ||
    deadlineOf(task, task.dueReads) !== undefined ||
    task.duration !== undefined ||
    task.remind.length > 0 ||
    (subtasks?.total ?? 0) > 0 ||
    (task.comments ?? 0) > 0 ||
    task.tags.length > 0 ||
    task.assignee !== undefined
  )
}

export function lineCount(task: TaskRow, meta: boolean, where: boolean): number {
  return 1 + (task.description ? 1 : 0) + (meta || where ? 1 : 0)
}

export interface Place {
  inbox: boolean
  name: string
  section: string | undefined
}

export function placeOf(row: Row): Place {
  const under = row.task?.section.at(-1)
  return {
    inbox: row.path === INBOX_PATH,
    name: row.file.basename,
    section: under === row.file.basename ? undefined : under,
  }
}

export function labelColour(tag: string, scheme: 'dark' | 'light'): string {
  const hues = ACCENTS.filter((one) => one.id !== 'slate')
  let sum = 0
  for (const character of tag.trim().toLowerCase()) {
    sum = (sum + (character.codePointAt(0) ?? 0)) % 4093
  }
  return accentColour(hues[sum % hues.length]?.id ?? DEFAULT_ACCENT, scheme)
}
