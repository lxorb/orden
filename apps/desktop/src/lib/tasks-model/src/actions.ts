import type { Priority as QuickPriority } from '@orden/markdown/task-line'
import { dayOf, shownTodos, sortedTodos } from './query'
import { openTodos, todos } from './start.svelte'
import { fittedDescription, titledOf, type Priority, type Todo } from './todo'

interface TaskOut {
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

function taskOut(todo: Todo): TaskOut {
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
  await openTodos()
  if (options.typed === false) {
    const made = await todos.add(titledOf(said))
    return made.ok ? { id: made.value.id } : null
  }
  const [{ parseQuickAdd }, { region }] = await Promise.all([
    import('@orden/bases/language'),
    import('../../platform/src/api'),
  ])
  const read = parseQuickAdd(said, [region()], new Date())
  const made = await addEntry({ text: read.text || said, fields: read.fields })
  return made ? { id: made.id } : null
}

export interface Asked {
  readonly text: string
  readonly description?: string
  readonly fields: {
    readonly tags: readonly string[]
    readonly due?: string
    readonly deadline?: string
    readonly priority?: QuickPriority
  }
}

export async function addEntry(entry: Asked): Promise<Todo | null> {
  await openTodos()
  const titled = titledOf(entry.text)
  const made = await todos.add({
    title: titled.title,
    description: fittedDescription(
      [titled.description, entry.description].filter(Boolean).join('\n\n'),
    ),
    labels: entry.fields.tags,
    start: entry.fields.due ?? null,
    deadline: entry.fields.deadline ?? null,
    priority: priorityOf(entry.fields.priority),
  })
  return made.ok ? made.value : null
}

export async function tickTask(id: string, done: boolean): Promise<boolean> {
  await openTodos()
  return (await todos.update(id, { done })).ok
}

export async function listed(): Promise<{ total: number; tasks: TaskOut[] }> {
  await openTodos()
  const shown = sortedTodos(
    shownTodos(todos.todos, { onlySpace: false, space: null, label: null, today: dayOf() }),
    'deadline',
  ).filter((one) => !one.done)
  return { total: shown.length, tasks: shown.slice(0, 50).map(taskOut) }
}
