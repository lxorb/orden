import { deadlineField, deadlineOf, startField, startOf } from '@orden/markdown/task-dates'
import {
  addDays,
  groupName,
  placeOfKey,
  type Priority,
  type Row,
  type TaskChange,
  type Value,
  isWhen,
} from '@orden/bases'
import type { RowChange } from '../rows/write'
import { bare, isNoteProperty } from './columns'
import { dayIn } from './values'

export type Drop =
  { change: RowChange } | { tick: true } | { move: { path?: string; heading?: string } }

type DateField = 'due' | 'scheduled' | 'start' | 'deadline'
const DATE_FIELDS: readonly string[] = ['due', 'scheduled', 'start', 'deadline']
const isDateField = (field: string): field is DateField => DATE_FIELDS.includes(field)

export const isPriority = (value: Value): value is Priority =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6

function dated(field: DateField, day: string | null): TaskChange {
  const change: TaskChange = {}
  change[field] = day
  return change
}

function taskDrop(field: string, key: Value, row: Row, today: string): Drop | null {
  const task = row.task
  if (!task) return null

  if (field === 'status' || field === 'done') {
    const status =
      field === 'done' ? (key === true ? 'x' : ' ') : typeof key === 'string' ? key : ' '
    if (status === task.status) return null
    if (status.toLowerCase() === 'x') return task.done ? null : { tick: true }
    if (status === '-') return { change: { task: { cancelled: true, completed: null } } }
    return { change: { task: { status, completed: null, cancelledOn: null } } }
  }

  if (field === 'priority') {
    const priority = isPriority(key) ? key : 4
    return priority === task.priority ? null : { change: { task: { priority } } }
  }

  if (isDateField(field) || field === 'date') {
    const day = key === null ? null : dayIn(key)
    if (key !== null && day === null) return null
    const reads = task.dueReads
    const which: DateField =
      field === 'date' || field === 'start'
        ? startField(task, reads)
        : field === 'deadline'
          ? deadlineField(task, reads)
          : field
    const change = dated(which, day)
    const deadline = deadlineOf(task, reads)
    const late = field === 'date' && day !== null && !task.done && !task.cancelled
    if (late && deadline !== undefined && deadline < today) {
      const moved = dated(deadlineField(task, reads), day)
      const placed = (startOf(task, reads) ?? task.scheduled) !== undefined
      return { change: { task: placed ? { ...change, ...moved } : moved } }
    }
    return { change: { task: change } }
  }

  if (field === 'assignee') {
    return { change: { task: { assignee: typeof key === 'string' && key ? key : null } } }
  }

  if (field === 'section') {
    return typeof key === 'string' ? { move: { heading: key } } : null
  }

  return null
}

export function dropInto(
  property: string,
  key: Value,
  row: Row,
  today: string,
  from?: Value,
): Drop | null {
  if (property === 'task.tags') {
    const task = row.task
    if (!task) return null
    const now = swapped(task.tags, key, from)
    const tags = Array.isArray(now) ? now.filter((one) => typeof one === 'string') : []
    return JSON.stringify(tags) === JSON.stringify(task.tags)
      ? null
      : { change: { task: { tags } } }
  }
  if (property.startsWith('task.')) return taskDrop(property.slice(5), key, row, today)

  if (isWhen(property)) {
    if (!row.task || row.task.done || row.task.cancelled) return null
    if (key === 'today') return taskDrop('deadline', today, row, today)
    if (key === 'tomorrow') return taskDrop('deadline', addDays(today, 1), row, today)
    if (key === null || key === '') return taskDrop('deadline', null, row, today)
    return null
  }

  if (property === 'formula.overdue') {
    return key === false && row.task ? taskDrop('deadline', today, row, today) : null
  }
  if (property === 'formula.day') {
    const task = row.task
    return task && !task.done && !task.cancelled ? taskDrop('date', key, row, today) : null
  }

  if ((property === 'file.path' || property === 'file.basename') && row.kind === 'task') {
    if (typeof key !== 'string' || !key) return null
    const { space, path } = property === 'file.path' ? placeOfKey(key) : { space: null, path: key }
    return space === null || space === row.space ? { move: { path } } : null
  }

  if (!isNoteProperty(property)) return null
  const name = bare(property)
  const now = row.note[name] ?? null
  const next = Array.isArray(now) ? swapped(now, key, from) : key
  if (JSON.stringify(now) === JSON.stringify(next)) return null
  return { change: { note: { [name]: next } } }
}

export function hourDrop(
  property: string,
  day: string,
  time: string,
  row: Row,
  today: string,
): Drop | null {
  const drop = dropInto(property, day, row, today)
  const timed = ['task.date', 'task.start', 'task.due', 'task.scheduled'].includes(property)
  if (!drop || !('change' in drop) || !drop.change.task || !timed) return drop
  return { change: { ...drop.change, task: { ...drop.change.task, time } } }
}

function swapped(now: readonly Value[], key: Value, from: Value | undefined): Value {
  if (Array.isArray(key)) return key
  if (from === undefined || Array.isArray(from)) return key === null ? null : [key]
  const named = (one: Value) => (one === null ? '' : groupName(one))
  if (named(from) === named(key)) return [...now]
  const kept = named(from) === '' ? [...now] : now.filter((one) => named(one) !== named(from))
  if (key === null || named(key) === '') return kept.length ? kept : null
  return kept.some((one) => named(one) === named(key)) ? kept : [...kept, key]
}
