import type { InboxFields } from '@orden/sync-core'
import { dayOf, groupedByLabel } from './query'
import { isPriority, PRIORITY_NAMES, type Priority, type Todo, type TodoPatch } from './todo'

export const GROUPINGS = ['label', 'deadline', 'priority'] as const
export type Grouping = (typeof GROUPINGS)[number]
export const GROUPING_NAMES: Readonly<Record<Grouping, string>> = {
  label: 'Label',
  deadline: 'Deadline',
  priority: 'Priority',
}
export const isGrouping = (value: unknown): value is Grouping =>
  typeof value === 'string' && (GROUPINGS as readonly string[]).includes(value)
export interface Column {
  readonly key: string
  readonly name: string
  readonly todos: Todo[]
  readonly takes: boolean
}
export interface Board {
  readonly grouping: Grouping
  readonly done: boolean
  readonly anyStart: boolean
  readonly columns: Readonly<Record<Grouping, readonly string[]>>
}
export const BOARD_ID = 'todo-board'
const BOARD_KIND = 'todo-board'
const NONE = ''
const plainBoard = (): Board => ({
  grouping: 'label',
  done: false,
  anyStart: false,
  columns: { label: [], deadline: [], priority: [] },
})
export function boardOf(fields: InboxFields | null): Board {
  const plain = plainBoard()
  if (fields?.kind !== BOARD_KIND) return plain
  const keys = (grouping: Grouping): readonly string[] => {
    const held = fields[grouping]
    return Array.isArray(held) ? held.filter((one): one is string => typeof one === 'string') : []
  }
  return {
    grouping: isGrouping(fields.grouping) ? fields.grouping : plain.grouping,
    done: fields.done === true,
    anyStart: fields.anyStart === true,
    columns: { label: keys('label'), deadline: keys('deadline'), priority: keys('priority') },
  }
}
export function boardFields(board: Board): InboxFields {
  const columns = Object.fromEntries(GROUPINGS.map((one) => [one, [...board.columns[one]]]))
  return { kind: BOARD_KIND, grouping: board.grouping, done: board.done, anyStart: board.anyStart, ...columns }
}
export function dayAfter(day: string, days: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return dayOf(new Date(year, month - 1, date + days))
}
const WEEK = 7
type Due = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'
const DUES: readonly { key: Due; name: string }[] = [
  { key: 'overdue', name: 'Overdue' },
  { key: 'today', name: 'Today' },
  { key: 'tomorrow', name: 'Tomorrow' },
  { key: 'week', name: 'Next 7 days' },
  { key: 'later', name: 'Later' },
  { key: 'none', name: 'No deadline' },
]
export function dueOf(deadline: string | null, today: string): Due {
  if (deadline === null) return 'none'
  if (deadline < today) return 'overdue'
  if (deadline === today) return 'today'
  if (deadline === dayAfter(today, 1)) return 'tomorrow'
  return deadline <= dayAfter(today, WEEK) ? 'week' : 'later'
}
const DUE_DAYS: Readonly<Record<Exclude<Due, 'overdue' | 'none'>, number>> = {
  today: 0,
  tomorrow: 1,
  week: 2,
  later: WEEK + 1,
}
const PRIORITY_KEYS = ['3', '2', '1', '0'] as const
export function columnsOf(todos: readonly Todo[], grouping: Grouping, today: string): Column[] {
  if (grouping === 'label') {
    const groups = groupedByLabel(todos)
    const columns = groups.map((group) => ({
      key: group.label ?? NONE,
      name: group.label ?? 'No label',
      todos: group.todos,
      takes: true,
    }))
    return columns.some((one) => one.key === NONE)
      ? columns
      : [...columns, { key: NONE, name: 'No label', todos: [], takes: true }]
  }
  if (grouping === 'deadline') {
    return DUES.map(({ key, name }) => ({
      key,
      name,
      todos: todos.filter((one) => dueOf(one.deadline, today) === key),
      takes: key !== 'overdue',
    })).filter((one) => one.key !== 'overdue' || one.todos.length)
  }
  return PRIORITY_KEYS.map((key) => ({
    key,
    name: PRIORITY_NAMES[Number(key) as Priority],
    todos: todos.filter((one) => String(one.priority) === key),
    takes: true,
  }))
}
export function orderedColumns(columns: readonly Column[], saved: readonly string[]): Column[] {
  const at = (column: Column) => {
    const index = saved.indexOf(column.key)
    return index === -1 ? saved.length : index
  }
  return columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => at(a.column) - at(b.column) || a.index - b.index)
    .map(({ column }) => column)
}
export function movedColumns(shown: readonly string[], key: string, to: number): string[] {
  const without = shown.filter((one) => one !== key)
  const place = Math.max(0, Math.min(without.length, to))
  return [...without.slice(0, place), key, ...without.slice(place)]
}
export function columnPatch(grouping: Grouping, key: string, today: string): TodoPatch | null {
  if (grouping === 'label') return { labels: key === NONE ? [] : [key] }
  if (grouping === 'priority') {
    const priority = Number(key)
    return isPriority(priority) ? { priority } : null
  }
  if (key === 'none') return { deadline: null }
  if (key in DUE_DAYS) return { deadline: dayAfter(today, DUE_DAYS[key as keyof typeof DUE_DAYS]) }
  return null
}
export function movedPatch(todo: Todo, grouping: Grouping, from: string, to: string, today: string): TodoPatch | null {
  if (from === to) return null
  if (grouping === 'label') {
    const kept = todo.labels.filter((one) => one !== from)
    return { labels: to === NONE ? [] : [...new Set([...kept, to])] }
  }
  if (grouping === 'deadline' && dueOf(todo.deadline, today) === to) return null
  return columnPatch(grouping, to, today)
}
