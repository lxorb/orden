import type { Priority as QuickPriority } from '@orden/markdown/task-line'
import {
  dayOf,
  type Priority,
  shownTodos,
  sortedTodos,
  type Todo,
  todos,
} from './tasks-model/src/api'

export interface TaskOut {
  at: string
  space: string
  text: string
  status?: string
  due?: string
  priority?: number
}

export function priorityOf(quick: QuickPriority | undefined): Priority {
  if (quick === 1) return 3
  if (quick === 2) return 2
  if (quick === 3) return 1
  return 0
}

export function taskOut(todo: Todo): TaskOut {
  return {
    at: todo.id,
    space: todo.space ?? '',
    text: todo.title,
    ...(todo.done ? { status: 'x' } : {}),
    ...(todo.deadline === null ? {} : { due: todo.deadline }),
    ...(todo.priority === 0 ? {} : { priority: 4 - todo.priority }),
  }
}

export async function addTask(
  text: string,
  options: { typed?: boolean } = {},
): Promise<{ id: string } | null> {
  const said = text.trim()
  if (!said) return null
  if (options.typed === false) {
    const made = await todos.add({ title: said })
    return made.ok ? { id: made.value.id } : null
  }
  const [{ parseQuickAdd }, { region }] = await Promise.all([
    import('@orden/bases/language'),
    import('./platform/src/api'),
  ])
  const read = parseQuickAdd(said, [region()], new Date())
  const made = await todos.add({
    title: read.text || said,
    labels: read.fields.tags,
    deadline: read.fields.deadline ?? read.fields.due ?? null,
    priority: priorityOf(read.fields.priority),
  })
  return made.ok ? { id: made.value.id } : null
}

export async function tickTask(id: string, done: boolean): Promise<boolean> {
  return (await todos.update(id, { done })).ok
}

export function listed(): { total: number; tasks: TaskOut[] } {
  const shown = sortedTodos(
    shownTodos(todos.todos, { onlySpace: false, space: null, label: null, today: dayOf() }),
    'deadline',
  ).filter((one) => !one.done)
  return { total: shown.length, tasks: shown.slice(0, 50).map(taskOut) }
}
