import type { Remind } from '@orden/markdown/task-line'
import type { Entry } from './entry'

export const CHANNEL = 'orden-quick-add'

export const ANSWERING = 'orden-quick-add-answering'

export type Said =
  | { kind: 'hello' }
  | { kind: 'world'; notes: string[]; lang: string; smart: boolean }
  | { kind: 'task'; id: number; entry: Entry; open: boolean }
  | { kind: 'added'; id: number; ok: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const optional = (value: unknown, check: (one: unknown) => boolean) =>
  value === undefined || check(value)

function isRemind(value: unknown): value is Remind {
  if (!isRecord(value)) return false
  if (typeof value.before === 'number') return true
  if (isString(value.at)) return isString(value.time)
  return isString(value.time)
}

function isEntry(value: unknown): value is Entry {
  if (!isRecord(value) || !isString(value.text) || !isRecord(value.fields)) return false
  const { fields } = value
  return (
    strings(fields.tags) &&
    Array.isArray(fields.remind) &&
    fields.remind.every(isRemind) &&
    ['due', 'time', 'recurrence', 'assignee', 'deadline'].every((key) =>
      optional(fields[key], isString),
    ) &&
    optional(fields.priority, (one) => one === 1 || one === 2 || one === 3 || one === 4) &&
    optional(fields.duration, (one) => typeof one === 'number' && one > 0) &&
    ['description', 'note', 'heading'].every((key) => optional(value[key], isString))
  )
}

export function heard(value: unknown): Said | null {
  if (!isRecord(value)) return null
  if (value.kind === 'hello') return { kind: 'hello' }
  if (
    value.kind === 'world' &&
    strings(value.notes) &&
    isString(value.lang) &&
    typeof value.smart === 'boolean'
  ) {
    return { kind: 'world', notes: value.notes, lang: value.lang, smart: value.smart }
  }
  if (
    value.kind === 'task' &&
    typeof value.id === 'number' &&
    isEntry(value.entry) &&
    typeof value.open === 'boolean'
  ) {
    return { kind: 'task', id: value.id, entry: value.entry, open: value.open }
  }
  if (value.kind === 'added' && typeof value.id === 'number' && typeof value.ok === 'boolean') {
    return { kind: 'added', id: value.id, ok: value.ok }
  }
  return null
}
