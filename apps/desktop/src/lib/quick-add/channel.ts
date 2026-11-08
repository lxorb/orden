import type { Remind } from '@orden/markdown/task-line'
import type { Entry } from './entry'

export const CHANNEL = 'orden-quick-add'

export const ANSWERING = 'orden-quick-add-answering'

export type Said =
  | { kind: 'hello' }
  | { kind: 'world'; notes: string[]; lang: string; smart: boolean }
  | { kind: 'task'; id: string; entry: Entry; open: boolean }
  | { kind: 'added'; id: string; ok: boolean }

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
    isString(value.id) &&
    isEntry(value.entry) &&
    typeof value.open === 'boolean'
  ) {
    return { kind: 'task', id: value.id, entry: value.entry, open: value.open }
  }
  if (value.kind === 'added' && isString(value.id) && typeof value.ok === 'boolean') {
    return { kind: 'added', id: value.id, ok: value.ok }
  }
  return null
}

export function asking(say: (said: Said) => void, within: number) {
  const waiting = new Map<string, (ok: boolean) => void>()
  const unsettled = new Map<string, string>()
  return {
    heard(said: Said) {
      if (said.kind !== 'added') return
      waiting.get(said.id)?.(said.ok)
      waiting.delete(said.id)
    },
    ask(entry: Entry, open: boolean): Promise<boolean> {
      const same = JSON.stringify([entry, open])
      const id = unsettled.get(same) ?? crypto.randomUUID()
      unsettled.set(same, id)
      return new Promise<boolean>((resolve) => {
        const unanswered = setTimeout(() => {
          waiting.delete(id)
          resolve(false)
        }, within)
        waiting.set(id, (ok) => {
          clearTimeout(unanswered)
          if (ok) unsettled.delete(same)
          resolve(ok)
        })
        say({ kind: 'task', id, entry, open })
      })
    },
  }
}

const REMEMBERED = 200

export function addingOnce(add: (entry: Entry, open: boolean) => Promise<boolean>) {
  const adding = new Map<string, Promise<boolean>>()
  return (id: string, entry: Entry, open: boolean): Promise<boolean> => {
    const already = adding.get(id)
    if (already) return already
    const added = add(entry, open).catch(() => false)
    adding.set(id, added)
    for (const old of adding.keys()) {
      if (adding.size <= REMEMBERED) break
      adding.delete(old)
    }
    void added.then((ok) => {
      if (!ok && adding.get(id) === added) adding.delete(id)
    })
    return added
  }
}
