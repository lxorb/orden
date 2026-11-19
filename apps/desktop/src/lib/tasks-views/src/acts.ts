import { todoWithAi } from '../../ai-chat/src/api'
import { fittedDescription, placedBetween, titledOf, todos, type Todo, type TodoPatch } from '../../tasks-model/src/api'
import { prompt } from '../../ui-kit/src/api'
import { undoToast } from '../../undo-toast/src/api'
import type { Shown } from './shown.svelte'

export async function addTodo(shown: Shown, title: string, patch: TodoPatch = {}): Promise<Todo | null> {
  const made = await todos.add({
    ...titledOf(title),
    space: shown.space?.id ?? null,
    ...(shown.filter.label === null ? {} : { labels: [shown.filter.label] }),
    ...patch,
  })
  return made.ok ? made.value : null
}
export async function patchTodo(id: string, patch: TodoPatch): Promise<string | null> {
  const kept = await todos.update(id, patch)
  return kept.ok ? null : kept.error.message
}
export async function tickTodo(shown: Shown, id: string, done: boolean): Promise<void> {
  if (done && !shown.showDone) shown.linger(id)
  if ((await patchTodo(id, { done })) !== null || !done) return
  undoToast.offer('done', () => patchTodo(id, { done: false }))
}
export async function removeTodo(id: string): Promise<void> {
  await removeTodos([id])
}
export async function removeTodos(ids: readonly string[]): Promise<boolean> {
  if (!ids.length) return false
  if (ids.length > 1) {
    const sure = await prompt.confirm({
      title: `Delete ${String(ids.length)} todos?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!sure) return false
  }
  await Promise.all(ids.map((id) => todos.remove(id)))
  undoToast.offer('deleted', () => Promise.all(ids.map((id) => todos.restore(id))))
  return true
}
function ascending(list: readonly Todo[]): boolean {
  return list.every((one, at) => at === 0 || (list[at - 1]?.order ?? -Infinity) < one.order)
}
export async function placeTodo(list: readonly Todo[], id: string): Promise<void> {
  const at = list.findIndex((one) => one.id === id)
  if (at === -1) return
  const others = list.filter((one) => one.id !== id)
  if (ascending(others)) {
    await patchTodo(id, { order: placedBetween(list[at - 1], list[at + 1]) })
    return
  }
  await Promise.all(
    list.flatMap((one, index) => (one.order === index + 1 ? [] : [patchTodo(one.id, { order: index + 1 })])),
  )
}
const LINK = /\[\[([^\]\n]+)\]\]/g
export const linksIn = (description: string): string[] => [
  ...new Set([...description.matchAll(LINK)].flatMap((one) => (one[1] ? [one[1].trim()] : []))),
]
export async function linkNotes(todo: Todo, names: readonly string[]): Promise<void> {
  const fresh = names.filter((one) => !linksIn(todo.description).includes(one))
  if (!fresh.length) return
  const lines = fresh.map((one) => `[[${one}]]`).join('\n')
  const description = fittedDescription(todo.description.trim() ? `${todo.description.trimEnd()}\n${lines}` : lines)
  await patchTodo(todo.id, { description })
}
export async function doWithAi(todo: Todo, space: string | null): Promise<boolean> {
  const { doWithAi: run } = await todoWithAi()
  return run(todo, todo.space ?? space ?? '')
}
