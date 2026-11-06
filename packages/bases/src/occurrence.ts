import type { TextEdit } from '@orden/markdown/edits'
import { changedTask, type TaskChange, writeTask } from '@orden/markdown/task-edits'
import { parseTask, readTask, type TaskFields } from '@orden/markdown/task-line'
import { addDays, dayNumber, todayOf } from './dates'
import { fewerTimes, nextDate, parseRule } from './recurrence'

export interface OccurrenceOptions {
  skipPast?: boolean
  created?: boolean
}

function referenceOf(task: TaskFields): string | undefined {
  return task.due ?? task.scheduled ?? task.start ?? task.deadline
}

const later = (a: string, b: string) => (a > b ? a : b)

export function nextOccurrence(
  task: TaskFields,
  today: string,
  options: OccurrenceOptions = {},
): TaskFields | null {
  if (!task.recurrence) return null
  const rule = parseRule(task.recurrence)
  if (!rule) return null
  if (rule.count !== undefined && rule.count <= 1) return null

  const reference = referenceOf(task)
  const next: TaskFields = { ...task, status: ' ', done: false, cancelled: false }
  if (rule.count !== undefined) next.recurrence = fewerTimes(task.recurrence, rule.count - 1)
  delete next.completed
  delete next.cancelledOn
  if (options.created) next.created = today

  if (rule.whenDone || !reference) {
    const date = nextDate(rule, today, today)
    if (!date) return null
    if (!reference) return next
    return shiftedBy(next, dayNumber(date) - dayNumber(reference))
  }

  const after = options.skipPast === false ? reference : later(reference, today)
  const date = nextDate(rule, reference, after)
  if (!date) return null
  return shiftedBy(next, dayNumber(date) - dayNumber(reference))
}

function shiftedBy(task: TaskFields, days: number): TaskFields {
  const moved = { ...task }
  for (const field of ['due', 'scheduled', 'start', 'deadline'] as const) {
    const date = task[field]
    if (date) moved[field] = addDays(date, days)
  }
  moved.remind = task.remind.map((one) =>
    'at' in one ? { ...one, at: addDays(one.at, days) } : one,
  )
  return moved
}

function changeBetween(before: TaskFields, after: TaskFields): TaskChange {
  const change: TaskChange = {}
  const fields = [
    'status',
    'recurrence',
    'due',
    'scheduled',
    'start',
    'deadline',
    'created',
    'completed',
    'cancelledOn',
    'remind',
  ] as const
  for (const field of fields) {
    const was = JSON.stringify(before[field] ?? null)
    const now = JSON.stringify(after[field] ?? null)
    if (was !== now) Object.assign(change, { [field]: after[field] ?? null })
  }
  return change
}

function linesOf(note: string): { text: string; from: number }[] {
  const out: { text: string; from: number }[] = []
  let from = 0
  for (const text of note.split('\n')) {
    out.push({ text: text.replace(/\r$/, ''), from })
    from += text.length + 1
  }
  return out
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0].length ?? 0

function childrenOf(lines: readonly { text: string }[], at: number): number[] {
  const own = indentOf(lines[at]?.text ?? '')
  const out: number[] = []
  for (let index = at + 1; index < lines.length; index++) {
    const text = lines[index]?.text ?? ''
    if (text.trim() === '') {
      const next = lines.slice(index + 1).find((one) => one.text.trim() !== '')
      if (!next || indentOf(next.text) <= own) break
      out.push(index)
      continue
    }
    if (indentOf(text) <= own) break
    out.push(index)
  }
  return out
}

const placed = (edits: readonly TextEdit[], from: number): TextEdit[] =>
  edits.map((edit) => ({ from: edit.from + from, to: edit.to + from, insert: edit.insert }))

export function tick(
  note: string,
  line: number,
  today: string,
  options: OccurrenceOptions = {},
): TextEdit[] {
  const lines = linesOf(note)
  const target = lines[line]
  if (!target) return []
  const task = readTask(target.text)
  if (!task) return []

  if (task.done || task.cancelled) {
    return placed(
      writeTask(target.text, { status: ' ', completed: null, cancelledOn: null }),
      target.from,
    )
  }

  const children = childrenOf(lines, line)
  const edits: TextEdit[] = []
  const next = nextOccurrence(task, today, options)

  if (next) {
    const nextLine = changedTask(target.text, { ...changeBetween(task, next), block: null })
    const block = [nextLine, ...repeatedChildren(lines, children)]
    if (task.onCompletion === 'delete') {
      edits.push({ from: target.from, to: target.from + target.text.length, insert: nextLine })
      return edits
    }
    edits.push({ from: target.from, to: target.from, insert: `${block.join('\n')}\n` })
  } else if (task.onCompletion === 'delete') {
    const end = target.from + target.text.length + (line < lines.length - 1 ? 1 : 0)
    return [{ from: target.from, to: end, insert: '' }]
  }

  edits.push(...placed(writeTask(target.text, { done: true }), target.from))
  for (const index of children) {
    const child = lines[index]
    const fields = child ? readTask(child.text) : null
    if (!child || !fields || fields.done || fields.cancelled) continue
    edits.push(...placed(writeTask(child.text, { done: true }), child.from))
  }
  return edits
}

function repeatedChildren(
  lines: readonly { text: string }[],
  children: readonly number[],
): string[] {
  const out: string[] = []
  let seenTask = false
  for (const index of children) {
    const text = lines[index]?.text ?? ''
    const parsed = parseTask(text)
    if (parsed) {
      seenTask = true
      out.push(changedTask(text, { status: ' ', completed: null, cancelledOn: null }))
    } else if (!seenTask) {
      out.push(text)
    }
  }
  while (out.length && out.at(-1)?.trim() === '') out.pop()
  return out
}

export function skip(line: string, today: string, options: OccurrenceOptions = {}): TextEdit[] {
  const task = readTask(line)
  if (!task) return []
  const next = nextOccurrence(task, today, { ...options, created: false })
  return next ? writeTask(line, changeBetween(task, { ...next, status: task.status })) : []
}

export function finish(line: string): TextEdit[] {
  return writeTask(line, { done: true, recurrence: null })
}

export { todayOf }
