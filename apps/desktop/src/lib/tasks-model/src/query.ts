import type { Todo } from './todo'

export const SORTS = ['deadline', 'priority', 'manual'] as const
export type Sort = (typeof SORTS)[number]
export const isSort = (value: unknown): value is Sort =>
  typeof value === 'string' && (SORTS as readonly string[]).includes(value)
export interface Filter {
  readonly label: string | null
  readonly today: string
  readonly done?: boolean
  readonly anyStart?: boolean
  readonly keep?: readonly string[]
}
export const ALL_LABELS = null
export function dayOf(at: number | Date = new Date()): string {
  const date = typeof at === 'number' ? new Date(at) : at
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
const started = (todo: Todo, today: string): boolean => todo.start === null || todo.start <= today
const hasLabel = (todo: Todo, label: string | null): boolean => label === ALL_LABELS || todo.labels.includes(label)
const stillShown = (todo: Todo, filter: Pick<Filter, 'done' | 'keep'>): boolean =>
  !todo.done || filter.done === true || (filter.keep?.includes(todo.id) ?? false)
export const shownTodos = (todos: readonly Todo[], filter: Filter): Todo[] =>
  todos.filter(
    (todo) =>
      stillShown(todo, filter) &&
      (filter.anyStart === true || started(todo, filter.today)) &&
      hasLabel(todo, filter.label),
  )
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
export function labelsOf(todos: readonly Todo[], filter: Pick<Filter, 'today' | 'done' | 'keep'>): string[] {
  const seen = new Set<string>()
  for (const todo of todos) {
    if (!stillShown(todo, filter)) continue
    for (const label of todo.labels) seen.add(label)
  }
  return [...seen].sort(byName)
}
const deadlineOrder = (a: Todo, b: Todo): number => {
  if (a.deadline === b.deadline) return 0
  if (a.deadline === null) return 1
  if (b.deadline === null) return -1
  return a.deadline < b.deadline ? -1 : 1
}
const priorityOrder = (a: Todo, b: Todo): number => b.priority - a.priority
const manualOrder = (a: Todo, b: Todo): number => a.order - b.order || a.created - b.created
export function sortedTodos(todos: readonly Todo[], sort: Sort, keep: readonly string[] = []): Todo[] {
  const finished = (one: Todo) => Number(one.done && !keep.includes(one.id))
  const order =
    sort === 'deadline'
      ? (a: Todo, b: Todo) => deadlineOrder(a, b) || priorityOrder(a, b) || manualOrder(a, b)
      : sort === 'priority'
        ? (a: Todo, b: Todo) => priorityOrder(a, b) || deadlineOrder(a, b) || manualOrder(a, b)
        : manualOrder
  return [...todos].sort((a, b) => finished(a) - finished(b) || order(a, b))
}
export interface Group {
  readonly label: string | null
  readonly todos: Todo[]
}
export function groupedByLabel(todos: readonly Todo[]): Group[] {
  const groups = new Map<string, Todo[]>()
  const unlabeled: Todo[] = []
  for (const todo of todos) {
    if (!todo.labels.length) {
      unlabeled.push(todo)
      continue
    }
    for (const label of todo.labels) {
      const held = groups.get(label)
      if (held) held.push(todo)
      else groups.set(label, [todo])
    }
  }
  const out: Group[] = [...groups].sort(([a], [b]) => byName(a, b)).map(([label, held]) => ({ label, todos: held }))
  if (unlabeled.length) out.push({ label: null, todos: unlabeled })
  return out
}
export function nextOrder(todos: readonly Todo[]): number {
  let most = 0
  for (const todo of todos) if (todo.order > most) most = todo.order
  return most + 1
}
export function placedBetween(before: Todo | undefined, after: Todo | undefined): number {
  if (before && after) return (before.order + after.order) / 2
  if (before) return before.order + 1
  if (after) return after.order - 1
  return 1
}
