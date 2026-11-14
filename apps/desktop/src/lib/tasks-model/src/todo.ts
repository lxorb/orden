import { err, failure, ok, type Result } from '@orden/contracts'
import type { InboxFields, InboxValue } from '@orden/sync-core'

export const PRIORITIES = [0, 1, 2, 3] as const

export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_NAMES: Readonly<Record<Priority, string>> = {
  0: 'No priority',
  1: 'Low',
  2: 'Medium',
  3: 'High',
}

export interface Subtask {
  readonly id: string
  readonly title: string
  readonly done: boolean
}

export interface Todo {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly labels: readonly string[]
  readonly space: string | null
  readonly start: string | null
  readonly deadline: string | null
  readonly priority: Priority
  readonly done: boolean
  readonly doneAt: number | null
  readonly subtasks: readonly Subtask[]
  readonly order: number
  readonly created: number
}

export type TodoPatch = Partial<Omit<Todo, 'id' | 'created' | 'doneAt'>>

export const LIMITS = {
  title: 500,
  description: 8000,
  labels: 20,
  label: 50,
  subtasks: 50,
} as const

export const KIND = 'todo'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

export const isPriority = (value: unknown): value is Priority =>
  typeof value === 'number' && (PRIORITIES as readonly number[]).includes(value)

export const cleanLabel = (label: string): string => label.trim().replace(/\s+/g, ' ')

const text = (value: InboxValue | undefined, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const texts = (value: InboxValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

function subtaskOf(value: string): Subtask | null {
  try {
    const read: unknown = JSON.parse(value)
    if (typeof read !== 'object' || read === null || Array.isArray(read)) return null
    const { id, title, done } = read as Record<string, unknown>
    if (typeof id !== 'string' || typeof title !== 'string') return null
    return { id, title, done: done === true }
  } catch {
    return null
  }
}

export function todoOf(id: string, fields: InboxFields): Todo | null {
  if (fields.kind !== KIND || fields.gone === true || typeof fields.title !== 'string') return null
  const priority = fields.priority
  return {
    id,
    title: fields.title,
    description: text(fields.description),
    labels: texts(fields.labels),
    space: typeof fields.space === 'string' && fields.space !== '' ? fields.space : null,
    start: isDay(fields.start) ? fields.start : null,
    deadline: isDay(fields.deadline) ? fields.deadline : null,
    priority: isPriority(priority) ? priority : 0,
    done: fields.done === true,
    doneAt: typeof fields.doneAt === 'number' ? fields.doneAt : null,
    subtasks: texts(fields.subtasks)
      .map(subtaskOf)
      .filter((one): one is Subtask => one !== null),
    order: typeof fields.order === 'number' ? fields.order : 0,
    created: typeof fields.created === 'number' ? fields.created : 0,
  }
}

export function fieldsOf(patch: TodoPatch): InboxFields {
  const fields: InboxFields = {}
  if (patch.title !== undefined) fields.title = patch.title
  if (patch.description !== undefined) fields.description = patch.description
  if (patch.labels !== undefined) fields.labels = [...patch.labels]
  if (patch.space !== undefined) fields.space = patch.space
  if (patch.start !== undefined) fields.start = patch.start
  if (patch.deadline !== undefined) fields.deadline = patch.deadline
  if (patch.priority !== undefined) fields.priority = patch.priority
  if (patch.done !== undefined) fields.done = patch.done
  if (patch.subtasks !== undefined) {
    fields.subtasks = patch.subtasks.map((one) =>
      JSON.stringify({ id: one.id, title: one.title, done: one.done }),
    )
  }
  if (patch.order !== undefined) fields.order = patch.order
  return fields
}

const refused = (message: string) => err(failure('tasks-model', 'invalid', message))

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export function checkedPatch(patch: TodoPatch): Result<TodoPatch> {
  const out: Mutable<TodoPatch> = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (title === '') return refused('a todo needs a title')
    if (title.length > LIMITS.title) return refused(`a title is at most ${LIMITS.title} characters`)
    out.title = title
  }
  if (patch.description !== undefined) {
    if (patch.description.length > LIMITS.description) {
      return refused(`a description is at most ${LIMITS.description} characters`)
    }
    out.description = patch.description
  }
  if (patch.labels !== undefined) {
    const labels = [...new Set(patch.labels.map(cleanLabel).filter((one) => one !== ''))]
    if (labels.length > LIMITS.labels) return refused(`a todo has at most ${LIMITS.labels} labels`)
    if (labels.some((one) => one.length > LIMITS.label)) {
      return refused(`a label is at most ${LIMITS.label} characters`)
    }
    out.labels = labels
  }
  if (patch.space !== undefined) out.space = patch.space === '' ? null : patch.space
  for (const key of ['start', 'deadline'] as const) {
    const day = patch[key]
    if (day === undefined) continue
    if (day !== null && !isDay(day)) return refused(`${key} must be a day as YYYY-MM-DD`)
    out[key] = day
  }
  if (patch.priority !== undefined) {
    if (!isPriority(patch.priority)) return refused('priority is 0, 1, 2 or 3')
    out.priority = patch.priority
  }
  if (patch.done !== undefined) out.done = patch.done
  if (patch.subtasks !== undefined) {
    const subtasks = patch.subtasks
      .map((one) => ({ id: one.id, title: one.title.trim(), done: one.done }))
      .filter((one) => one.title !== '')
    if (subtasks.length > LIMITS.subtasks) {
      return refused(`a todo has at most ${LIMITS.subtasks} subtasks`)
    }
    if (subtasks.some((one) => one.title.length > LIMITS.title)) {
      return refused(`a subtask title is at most ${LIMITS.title} characters`)
    }
    out.subtasks = subtasks
  }
  if (patch.order !== undefined) {
    if (!Number.isFinite(patch.order)) return refused('order must be a number')
    out.order = patch.order
  }
  return ok(out)
}

export const newId = (): string => `t${crypto.randomUUID().replace(/-/g, '').slice(0, 15)}`
