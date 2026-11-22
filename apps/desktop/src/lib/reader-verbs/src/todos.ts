import { said, type Said, yes } from '../../automation/src/api'
import { isPriority, type Priority, sortedTodos, type Todo, type TodoPatch, todos } from '../../tasks-model/src/api'
import { need } from './need'
import { Refused } from './refused'

function count(args: Said, name: string, fallback: number, most: number): number {
  const sent = args[name]
  const value = sent === null ? Number.NaN : Number(sent)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), most)
}
export function todoOut(todo: Todo) {
  return {
    id: todo.id,
    title: todo.title,
    done: todo.done,
    labels: todo.labels,
    start: todo.start,
    deadline: todo.deadline,
    priority: todo.priority,
    ...(todo.description ? { description: todo.description } : {}),
    ...(todo.repeat ? { repeat: todo.repeat } : {}),
    ...(todo.subtasks.length ? { subtasks: todo.subtasks } : {}),
  }
}
function textsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((one): one is string => typeof one === 'string')
}
function dayArg(args: Said, name: string): string | null | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new Refused('bad_arguments', `${name} is a day as YYYY-MM-DD`)
  return value
}
function repeatArg(args: Said): string | null | undefined {
  const value = args.repeat
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new Refused(
      'bad_arguments',
      'repeat is a rule like "every 3 days", or "every! 10 days" to count from when it is done',
    )
  }
  return value
}
function priorityArg(args: Said): Priority | undefined {
  const sent = args.priority
  if (sent === undefined) return undefined
  const value = typeof sent === 'string' && /^\s*\d+\s*$/.test(sent) ? Number(sent) : sent
  if (!isPriority(value)) throw new Refused('bad_arguments', 'priority is 0, 1, 2 or 3')
  return value
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
function patchOf(args: Said): TodoPatch {
  const patch: Mutable<TodoPatch> = {}
  const title = said(args, 'title') ?? said(args, 'text')
  if (title !== null) patch.title = title
  const description = args.description
  if (typeof description === 'string') patch.description = description
  const labels = textsOf(args.labels) ?? textsOf(args.tags)
  if (labels !== undefined) patch.labels = labels
  const start = dayArg(args, 'start')
  if (start !== undefined) patch.start = start
  const deadline = dayArg(args, 'deadline' in args ? 'deadline' : 'due')
  if (deadline !== undefined) patch.deadline = deadline
  const priority = priorityArg(args)
  if (priority !== undefined) patch.priority = priority
  const repeat = repeatArg(args)
  if (repeat !== undefined) patch.repeat = repeat
  if (args.done !== undefined && args.done !== null) patch.done = yes(args, 'done')
  return patch
}
export function listTodos(args: Said) {
  const label = said(args, 'label')
  const withDone = yes(args, 'done')
  const limit = count(args, 'limit', 50, Number.MAX_SAFE_INTEGER)
  const shown = sortedTodos(
    todos.todos.filter((one) => (label === null || one.labels.includes(label)) && (withDone || !one.done)),
    'deadline',
  )
  return { total: shown.length, todos: shown.slice(0, limit).map(todoOut) }
}
export const todoTitle = (args: Said): string => said(args, 'title') ?? need(args, 'text')
export async function addTodo(args: Said, title: string) {
  const made = await todos.add({ ...patchOf(args), title, done: false })
  if (!made.ok) throw new Refused('bad_arguments', made.error.message)
  return todoOut(made.value)
}
export function todoNamed(args: Said): Todo {
  const id = said(args, 'id') ?? need(args, 'at')
  const was = todos.todo(id)
  if (!was) throw new Refused('no_such_file', `there is no todo ${id}`)
  return was
}
export async function updateTodo(args: Said, id: string) {
  const kept = await todos.update(id, patchOf(args))
  if (!kept.ok) throw new Refused('bad_arguments', kept.error.message)
  return todoOut(kept.value)
}
