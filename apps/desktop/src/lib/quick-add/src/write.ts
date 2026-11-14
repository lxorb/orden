import { priorityOf } from '../../task-actions'
import { todos, type Todo } from '../../tasks-model/src/api'
import type { Entry } from './entry'

let adding: Promise<unknown> = Promise.resolve()

export async function addTask(
  entry: Entry,
  options: { open?: boolean } = {},
): Promise<Todo | null> {
  const added = adding.then(() => addOne(entry))
  adding = added.catch(() => undefined)
  const landed = await added
  if (landed && options.open) {
    const { showTodos } = await import('../../todos-entry')
    await showTodos()
  }
  return landed
}

async function addOne(entry: Entry): Promise<Todo | null> {
  const made = await todos.add({
    title: entry.text,
    description: entry.description ?? '',
    labels: entry.fields.tags,
    deadline: entry.fields.deadline ?? entry.fields.due ?? null,
    priority: priorityOf(entry.fields.priority),
  })
  return made.ok ? made.value : null
}
