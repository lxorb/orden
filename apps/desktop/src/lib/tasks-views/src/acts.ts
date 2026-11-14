import { todos, type Todo, type TodoPatch } from '../../tasks-model/src/api'
import type { Shown } from './shown.svelte'

export async function addTodo(shown: Shown, title: string): Promise<Todo | null> {
  const made = await todos.add({
    title,
    space: shown.space?.id ?? null,
    ...(shown.filter.label === null ? {} : { labels: [shown.filter.label] }),
  })
  return made.ok ? made.value : null
}

export async function patchTodo(id: string, patch: TodoPatch): Promise<string | null> {
  const kept = await todos.update(id, patch)
  return kept.ok ? null : kept.error.message
}

export async function removeTodo(id: string): Promise<void> {
  await todos.remove(id)
}
