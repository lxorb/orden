/** What a row dropped into a group means: the change that makes the row belong there.
 *
 *  A board's columns, the days of Upcoming and the calendar, Today's two halves and a
 *  project's headings are all groups of one property, so a drop is one question asked
 *  of that property: which value would put this row in that group? A status column
 *  answers with the box's character, a day with the date, a heading with a move of the
 *  line, a note property with the property. A group whose property no row can be
 *  written through (a formula, a file's size) answers nothing, and the card goes back.
 *
 *  Pure. The tab writes what this answers through the one write path, or ticks
 *  through the engine where the answer is "done", so a recurring task dropped on Done
 *  makes its next occurrence as a tick in the editor would. */

import { deadlineField, startField } from '@nib/markdown/task-dates'
import { groupName, type Priority, type Row, type TaskChange, type Value } from '@nib/bases'
import type { RowChange } from '../rows/write'
import { bare, isNoteProperty } from './columns'
import { dayIn } from './values'

export type Drop =
  /** A field or a property written. */
  | { change: RowChange }
  /** The task ticked, as its box would be. */
  | { tick: true }
  /** The task's lines moved under another heading of its note, or to another note. */
  | { move: { path?: string; heading?: string } }

type DateField = 'due' | 'scheduled' | 'start' | 'deadline'
const DATE_FIELDS: readonly string[] = ['due', 'scheduled', 'start', 'deadline']
const isDateField = (field: string): field is DateField => DATE_FIELDS.includes(field)

export const isPriority = (value: Value): value is Priority =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6

/** One date field set, or taken away. */
function dated(field: DateField, day: string | null): TaskChange {
  const change: TaskChange = {}
  change[field] = day
  return change
}

/** What a task row dropped into a group of one of its own fields means. */
function taskDrop(field: string, key: Value, row: Row, today: string): Drop | null {
  const task = row.task
  if (!task) return null

  if (field === 'status' || field === 'done') {
    const status =
      field === 'done' ? (key === true ? 'x' : ' ') : typeof key === 'string' ? key : ' '
    if (status === task.status) return null
    if (status.toLowerCase() === 'x') return task.done ? null : { tick: true }
    if (status === '-')
      return { change: { task: { cancelled: true, cancelledOn: today, completed: null } } }
    return { change: { task: { status, completed: null, cancelledOn: null } } }
  }

  if (field === 'priority') {
    const priority = isPriority(key) ? key : 4
    return priority === task.priority ? null : { change: { task: { priority } } }
  }

  if (isDateField(field) || field === 'date') {
    const day = key === null ? null : dayIn(key)
    if (key !== null && day === null) return null
    // `task.date` and `task.start` are the day the task starts, `task.deadline` its
    // deadline, each as its space reads a `📅` (#371): a drop moves the field that holds
    // it, and gives a task with none a `🛫` or a `[deadline::]`.
    const reads = task.dueReads
    const which: DateField =
      field === 'date' || field === 'start'
        ? startField(task, reads)
        : field === 'deadline'
          ? deadlineField(task, reads)
          : field
    return { change: { task: dated(which, day) } }
  }

  if (field === 'assignee') {
    return { change: { task: { assignee: typeof key === 'string' && key ? key : null } } }
  }

  if (field === 'section') {
    return typeof key === 'string' ? { move: { heading: key } } : null
  }

  return null
}

/** The drop into the group keyed `key` of a view grouped by `property`, or null
 *  where no write would put the row there. `today` is the reader's day. `from` is the
 *  key of the group the row was carried out of, where it was in one: a card of a list
 *  sits in a column per member, and carrying it from one to another swaps that member
 *  alone, carrying it to the group of no value takes that member out, and carrying it
 *  out of the group of no value adds one. */
export function dropInto(
  property: string,
  key: Value,
  row: Row,
  today: string,
  from?: Value,
): Drop | null {
  if (property.startsWith('task.')) return taskDrop(property.slice(5), key, row, today)

  // The built-in views' own groupings: Today's overdue half and its today half, and
  // Upcoming's days. Their names are the builtins' (see builtins.ts in @nib/bases).
  // Out of the overdue half, a task is due today: its deadline is what made it late.
  if (property === 'formula.overdue') {
    return key === false && row.task ? taskDrop('deadline', today, row, today) : null
  }
  if (property === 'formula.day') return row.task ? taskDrop('date', key, row, today) : null

  // A task grouped by the note it is in moves to that note.
  if ((property === 'file.path' || property === 'file.basename') && row.kind === 'task') {
    return typeof key === 'string' && key ? { move: { path: key } } : null
  }

  if (!isNoteProperty(property)) return null
  const name = bare(property)
  const now = row.note[name] ?? null
  const next = Array.isArray(now) ? swapped(now, key, from) : key
  if (JSON.stringify(now) === JSON.stringify(next)) return null
  return { change: { note: { [name]: next } } }
}

/** A list with the member it was carried out of (`from`) swapped for `key`: taken out
 *  where `key` is no value, added where it came from no value. Carried from nowhere
 *  known, the list becomes that one member, as a drop always made it. */
function swapped(now: readonly Value[], key: Value, from: Value | undefined): Value {
  if (Array.isArray(key)) return key
  if (from === undefined) return key === null ? null : [key]
  const named = (one: Value) => (one === null ? '' : groupName(one))
  const kept = named(from) === '' ? [...now] : now.filter((one) => named(one) !== named(from))
  if (key === null || named(key) === '') return kept.length ? kept : null
  return kept.some((one) => named(one) === named(key)) ? kept : [...kept, key]
}
