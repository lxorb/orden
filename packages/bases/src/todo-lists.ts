import { carriedOwn } from './inbox'
import type { Row } from './types'

export const LIST_KEY = 'todo-list'
export const LIST_VALUE = 'yes'
export const DONE_KEY = 'done-on'
export const CANCELLED_KEY = 'cancelled-on'

export const LIST_KEYS: ReadonlySet<string> = new Set([LIST_KEY, DONE_KEY, CANCELLED_KEY])

const LONGEST = 2048

export type Meta = Readonly<Record<string, string>> | null | undefined

export type DatesPatch = Record<string, string | null>

const key = (path: string) =>
  path.replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC').toLowerCase()

export function isTodoList(path: string, meta: Meta, inbox?: string): boolean {
  if (carriedOwn(path)) return true
  if (inbox !== undefined && key(path) === key(inbox)) return true
  return meta?.[LIST_KEY] === LIST_VALUE
}

const ENTRY = /^([0-9a-z]{1,13}):(\d{4})(\d{2})(\d{2})$/

export function datesOf(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const one of (value ?? '').split(' ')) {
    const found = ENTRY.exec(one)
    if (found) out.set(found[1] ?? '', `${found[2]}-${found[3]}-${found[4]}`)
  }
  return out
}

export function datesText(dates: ReadonlyMap<string, string>): string | null {
  const newest = [...dates].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
  let text = ''
  for (const [hash, day] of newest) {
    const one = `${hash}:${day.replace(/-/g, '')}`
    if (text.length + one.length + 1 > LONGEST) break
    text = text ? `${text} ${one}` : one
  }
  return text || null
}

interface Seen {
  line: number
  hash: string
  done: boolean
  cancelled: boolean
}

function seenOf(rows: readonly Row[]): Seen[] {
  return rows.flatMap((row) =>
    row.task && row.anchor
      ? [{ ...row.anchor, done: row.task.done, cancelled: row.task.cancelled }]
      : [],
  )
}

function changed(
  before: readonly Seen[],
  after: readonly Seen[],
  had: string | undefined,
  closed: (one: Seen) => boolean,
  today: string,
): string | null | undefined {
  const dates = datesOf(had)
  const was = new Set(before.filter(closed).map((one) => one.hash))
  const now = after.filter(closed)
  const atLine = new Map(before.map((one) => [one.line, one]))
  for (const one of now) {
    if (dates.has(one.hash)) continue
    const there = atLine.get(one.line)
    const carried = there && closed(there) ? dates.get(there.hash) : undefined
    if (carried !== undefined) dates.set(one.hash, carried)
    else if (!was.has(one.hash)) dates.set(one.hash, today)
  }
  const kept = new Set(now.map((one) => one.hash))
  for (const hash of [...dates.keys()]) if (!kept.has(hash)) dates.delete(hash)
  const text = datesText(dates)
  return text === (had ?? null) ? undefined : text
}

export function datesChanged(
  before: readonly Row[] | null,
  after: readonly Row[],
  meta: Meta,
  today: string,
): DatesPatch | null {
  if (before === null) return null
  const was = seenOf(before)
  const now = seenOf(after)
  const patch: DatesPatch = {}
  const done = changed(was, now, meta?.[DONE_KEY], (one) => one.done, today)
  if (done !== undefined) patch[DONE_KEY] = done
  const cancelled = changed(was, now, meta?.[CANCELLED_KEY], (one) => one.cancelled, today)
  if (cancelled !== undefined) patch[CANCELLED_KEY] = cancelled
  return Object.keys(patch).length ? patch : null
}

export function withDates(rows: Row[], meta: Meta): Row[] {
  const done = datesOf(meta?.[DONE_KEY])
  const cancelled = datesOf(meta?.[CANCELLED_KEY])
  if (!done.size && !cancelled.size) return rows
  for (const row of rows) {
    const task = row.task
    const hash = row.anchor?.hash
    if (!task || hash === undefined) continue
    if (task.done && task.completed === undefined) {
      const day = done.get(hash)
      if (day !== undefined) task.completed = day
    }
    if (task.cancelled && task.cancelledOn === undefined) {
      const day = cancelled.get(hash)
      if (day !== undefined) task.cancelledOn = day
    }
  }
  return rows
}
