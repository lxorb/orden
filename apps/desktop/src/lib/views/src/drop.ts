import { deadlineField, deadlineOf, startField, startOf } from '@orden/markdown/task-dates'
import { addDays, groupName, isWhen, type Row, type TaskChange, todayOf, type Value } from '@orden/bases'
import type { RowChange } from '../../rows/src/api'
import { bare, isNoteProperty } from './columns'
import { dayIn } from './values'

export interface Drop {
  change: RowChange
}

type DateField = 'due' | 'scheduled' | 'start' | 'deadline'
const DATE_FIELDS: readonly string[] = ['due', 'scheduled', 'start', 'deadline']
const isDateField = (field: string): field is DateField => DATE_FIELDS.includes(field)

const isPriority = (value: Value): value is 1 | 2 | 3 | 4 | 5 | 6 =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6

const taskChange = (task: TaskChange): Drop => ({ change: { task } })

function datedDrop(field: string, key: Value, row: Row, today: string): Drop | null {
  const task = row.task
  if (!task) return null
  const day = key === null ? null : dayIn(key)
  if (key !== null && day === null) return null
  const reads = task.dueReads
  const which: DateField =
    field === 'date' || field === 'start'
      ? startField(task, reads)
      : field === 'deadline'
        ? deadlineField(task, reads)
        : isDateField(field)
          ? field
          : startField(task, reads)
  const change: TaskChange = { [which]: day }
  const deadline = deadlineOf(task, reads)
  const late = field === 'date' && day !== null && !task.done && !task.cancelled
  if (late && deadline !== undefined && deadline < today) {
    const moved: TaskChange = { [deadlineField(task, reads)]: day }
    const placed = (startOf(task, reads) ?? task.scheduled) !== undefined
    return taskChange(placed ? { ...change, ...moved } : moved)
  }
  return taskChange(change)
}

function taskDrop(field: string, key: Value, row: Row, today: string, from?: Value): Drop | null {
  const task = row.task
  if (row.kind !== 'task' || !task) return null
  if (field === 'tags') {
    const now = swapped(task.tags, key, from)
    const tags = Array.isArray(now) ? now.filter((one) => typeof one === 'string') : []
    return JSON.stringify(tags) === JSON.stringify(task.tags) ? null : taskChange({ tags })
  }
  if (field === 'status' || field === 'done') {
    const status = field === 'done' ? (key === true ? 'x' : ' ') : typeof key === 'string' && key ? key : ' '
    if (status === task.status) return null
    if (status.toLowerCase() === 'x') return task.done ? null : taskChange({ done: true })
    if (status === '-') return taskChange({ cancelled: true, completed: null })
    return taskChange({ status, completed: null, cancelledOn: null })
  }
  if (field === 'priority') {
    const priority = isPriority(key) ? key : 4
    return priority === task.priority ? null : taskChange({ priority })
  }
  if (isDateField(field) || field === 'date') return datedDrop(field, key, row, today)
  if (field === 'assignee') {
    const assignee = typeof key === 'string' && key ? key : null
    return assignee === (task.assignee ?? null) ? null : taskChange({ assignee })
  }
  return null
}

export function dropInto(property: string, key: Value, row: Row, from?: Value, today = todayOf()): Drop | null {
  if (property.startsWith('task.')) return taskDrop(property.slice(5), key, row, today, from)
  if (isWhen(property)) {
    if (!row.task || row.task.done || row.task.cancelled) return null
    if (key === 'today') return datedDrop('deadline', today, row, today)
    if (key === 'tomorrow') return datedDrop('deadline', addDays(today, 1), row, today)
    if (key === null || key === '') return datedDrop('deadline', null, row, today)
    return null
  }
  if (property === 'formula.overdue') {
    return key === false && row.task ? datedDrop('deadline', today, row, today) : null
  }
  if (property === 'formula.day') {
    const task = row.task
    return task && !task.done && !task.cancelled ? datedDrop('date', key, row, today) : null
  }
  if (!isNoteProperty(property)) return null
  const name = bare(property)
  const now = row.note[name] ?? null
  const next = Array.isArray(now) ? swapped(now, key, from) : key
  if (JSON.stringify(now) === JSON.stringify(next)) return null
  return { change: { note: { [name]: next } } }
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

function joined(one: RowChange, next: RowChange): RowChange {
  const change: RowChange = {}
  if (one.note || next.note) change.note = { ...one.note, ...next.note }
  if (one.task || next.task) change.task = { ...one.task, ...next.task }
  if (one.list || next.list) change.list = { ...one.list, ...next.list }
  return change
}

export function inTurn(drops: readonly (Drop | null)[]): Drop[] {
  const changes = drops.flatMap((one) => (one ? [one.change] : []))
  return changes.length ? [{ change: changes.reduce(joined) }] : []
}
