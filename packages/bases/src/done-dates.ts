import { changedTask, type TaskChange } from '@orden/markdown/task-edits'
import { taskRowsOfText } from './task-rows'
import type { Row } from './types'

export const DONE_KEY = 'done-on'
export const CANCELLED_KEY = 'cancelled-on'

export const DATE_KEYS: ReadonlySet<string> = new Set([DONE_KEY, CANCELLED_KEY])

const LONGEST = 2048

export type Meta = Readonly<Record<string, string>> | null | undefined

export type DatesPatch = Record<string, string | null>

const ENTRY = /^([0-9a-z]{1,13}):(?:(\d{4})(\d{2})(\d{2})|-)$/

const MOST = 40000

type Day = string | null

export function datesOf(value: string | undefined): Map<string, Day[]> {
  const out = new Map<string, Day[]>()
  for (const one of (value ?? '').split(' ')) {
    const found = ENTRY.exec(one)
    if (!found) continue
    const hash = found[1] ?? ''
    const day = found[2] === undefined ? null : `${found[2]}-${found[3]}-${found[4]}`
    const days = out.get(hash)
    if (days) days.push(day)
    else out.set(hash, [day])
  }
  return out
}

const newestOf = (days: readonly Day[]) =>
  days.reduce<string>((top, day) => (day !== null && day > top ? day : top), '')

export function datesText(dates: ReadonlyMap<string, string | readonly Day[]>): string | null {
  const groups = [...dates]
    .map(([hash, days]) => ({
      hash,
      days: typeof days === 'string' ? [days] : days,
    }))
    .filter((group) => group.days.some((day) => day !== null))
    .map((group) => ({ ...group, newest: newestOf(group.days) }))
    .sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0))
  let text = ''
  for (const { hash, days } of groups) {
    const one = days.map((day) => `${hash}:${day === null ? '-' : day.replace(/-/g, '')}`).join(' ')
    if (text.length + one.length + 1 > LONGEST) break
    text = text ? `${text} ${one}` : one
  }
  return text || null
}

function nextDay(
  dates: ReadonlyMap<string, readonly Day[]>,
  slots: Map<string, number>,
  hash: string,
) {
  const slot = slots.get(hash) ?? 0
  slots.set(hash, slot + 1)
  const days = dates.get(hash)
  return days?.length ? (days[Math.min(slot, days.length - 1)] ?? null) : null
}

interface Seen {
  line: number
  hash: string
  key: string
  done: boolean
  cancelled: boolean
}

function seenOf(rows: readonly Row[]): Seen[] {
  return rows.flatMap((row) => {
    const task = row.task
    if (!task || !row.anchor) return []
    const mark = task.done ? 'x' : task.cancelled ? '-' : ' '
    return [
      {
        ...row.anchor,
        key: `${row.anchor.hash}${mark}`,
        done: task.done,
        cancelled: task.cancelled,
      },
    ]
  })
}

function common(
  before: readonly Seen[],
  after: readonly Seen[],
  from: number,
  pair: (now: number, was: number) => void,
  ends: { was: number; now: number },
) {
  const wide = ends.now - from + 1
  const tall = ends.was - from
  if (tall <= 0 || wide <= 1 || tall * wide > MOST) return
  const table = new Uint16Array((tall + 1) * wide)
  const at = (was: number, now: number) => table[(was - from) * wide + now - from] ?? 0
  const same = (was: number, now: number) => before[was]?.key === after[now]?.key
  for (let was = ends.was - 1; was >= from; was--) {
    for (let now = ends.now - 1; now >= from; now--) {
      table[(was - from) * wide + now - from] = same(was, now)
        ? at(was + 1, now + 1) + 1
        : Math.max(at(was + 1, now), at(was, now + 1))
    }
  }
  let was = from
  let now = from
  while (was < ends.was && now < ends.now) {
    if (same(was, now)) {
      pair(now, was)
      was++
      now++
    } else if (at(was + 1, now) >= at(was, now + 1)) was++
    else now++
  }
}

function paired(before: readonly Seen[], after: readonly Seen[]): (number | undefined)[] {
  const from: (number | undefined)[] = after.map(() => undefined)
  const taken = new Set<number>()
  const pair = (now: number, was: number) => {
    from[now] = was
    taken.add(was)
  }
  const same = (was: number, now: number) => before[was]?.key === after[now]?.key
  let head = 0
  while (head < before.length && head < after.length && same(head, head)) {
    pair(head, head)
    head++
  }
  let tail = 0
  const room = Math.min(before.length, after.length) - head
  while (tail < room && same(before.length - 1 - tail, after.length - 1 - tail)) {
    pair(after.length - 1 - tail, before.length - 1 - tail)
    tail++
  }
  common(before, after, head, pair, { was: before.length - tail, now: after.length - tail })
  const left = (by: (one: Seen) => string | number) => {
    const queues = new Map<string | number, number[]>()
    before.forEach((one, was) => {
      if (taken.has(was)) return
      const queue = queues.get(by(one))
      if (queue) queue.push(was)
      else queues.set(by(one), [was])
    })
    after.forEach((one, now) => {
      const was = from[now] === undefined ? queues.get(by(one))?.shift() : undefined
      if (was !== undefined) pair(now, was)
    })
  }
  left((one) => one.key)
  left((one) => one.hash)
  left((one) => one.line)
  const twins = new Map<string, number[]>()
  from.forEach((was, now) => {
    const key = after[now]?.key
    if (was === undefined || key === undefined || before[was]?.key !== key) return
    const group = twins.get(key)
    if (group) group.push(now)
    else twins.set(key, [now])
  })
  for (const group of twins.values()) {
    const sources = group.map((now) => from[now] ?? 0).sort((a, b) => a - b)
    for (const [at, now] of group.entries()) from[now] = sources[at]
  }
  return from
}

export type Arrived = (hash: string, cancelled: boolean) => string | undefined

function changed(
  before: readonly Seen[],
  after: readonly Seen[],
  from: readonly (number | undefined)[],
  had: string | undefined,
  closed: (one: Seen) => boolean,
  today: string,
  arrived: (hash: string) => string | undefined,
): string | null | undefined {
  const dates = datesOf(had)
  const counted = (list: readonly Seen[]) => {
    const out = new Map<string, number>()
    for (const one of list) if (closed(one)) out.set(one.hash, (out.get(one.hash) ?? 0) + 1)
    return out
  }
  const was = counted(before)
  const now = counted(after)
  const slots = new Map<string, number>()
  const daysBefore = before.map((one) => (closed(one) ? nextDay(dates, slots, one.hash) : null))
  const out = new Map<string, Day[]>()
  after.forEach((one, at) => {
    if (!closed(one)) return
    const kept = dates.get(one.hash)
    if (kept && kept.length === now.get(one.hash) && kept.length !== (was.get(one.hash) ?? 0)) {
      out.set(one.hash, kept)
      return
    }
    const source = from[at]
    const there = source === undefined ? undefined : before[source]
    const day =
      source !== undefined && there && closed(there)
        ? (daysBefore[source] ?? null)
        : source === undefined
          ? (arrived(one.hash) ?? today)
          : today
    const days = out.get(one.hash)
    if (days) days.push(day)
    else out.set(one.hash, [day])
  })
  const text = datesText(out)
  return text === (had ?? null) ? undefined : text
}

const alike = (a: readonly Seen[], b: readonly Seen[]) =>
  a.length === b.length && a.every((one, at) => one.key === b[at]?.key)

export function datesChanged(
  before: readonly Row[] | null,
  after: readonly Row[],
  meta: Meta,
  today: string,
  arrived: Arrived = () => undefined,
): DatesPatch | null {
  if (before === null) return null
  const was = seenOf(before)
  const now = seenOf(after)
  if (alike(was, now)) return null
  const from = paired(was, now)
  const patch: DatesPatch = {}
  const done = changed(
    was,
    now,
    from,
    meta?.[DONE_KEY],
    (one) => one.done,
    today,
    (hash) => arrived(hash, false),
  )
  if (done !== undefined) patch[DONE_KEY] = done
  const cancelled = changed(
    was,
    now,
    from,
    meta?.[CANCELLED_KEY],
    (one) => one.cancelled,
    today,
    (hash) => arrived(hash, true),
  )
  if (cancelled !== undefined) patch[CANCELLED_KEY] = cancelled
  return Object.keys(patch).length ? patch : null
}

export function withDates(rows: Row[], meta: Meta): Row[] {
  const done = datesOf(meta?.[DONE_KEY])
  const cancelled = datesOf(meta?.[CANCELLED_KEY])
  if (!done.size && !cancelled.size) return rows
  const doneSlots = new Map<string, number>()
  const cancelledSlots = new Map<string, number>()
  for (const row of rows) {
    const task = row.task
    const hash = row.anchor?.hash
    if (!task || hash === undefined) continue
    if (task.done) {
      const day = nextDay(done, doneSlots, hash)
      if (task.completed === undefined && day !== null) task.completed = day
    }
    if (task.cancelled) {
      const day = nextDay(cancelled, cancelledSlots, hash)
      if (task.cancelledOn === undefined && day !== null) task.cancelledOn = day
    }
  }
  return rows
}

export function writtenDates(text: string, meta: Meta): string {
  const done = datesOf(meta?.[DONE_KEY])
  const cancelled = datesOf(meta?.[CANCELLED_KEY])
  if (!done.size && !cancelled.size) return text
  const lines = text.split('\n')
  const doneSlots = new Map<string, number>()
  const cancelledSlots = new Map<string, number>()
  for (const row of taskRowsOfText('', '', text)) {
    const task = row.task
    const at = row.anchor
    if (!task || !at) continue
    const change: TaskChange = {}
    const doneOn = task.done ? nextDay(done, doneSlots, at.hash) : null
    if (doneOn !== null && task.completed === undefined) change.completed = doneOn
    const cancelledOn = task.cancelled ? nextDay(cancelled, cancelledSlots, at.hash) : null
    if (cancelledOn !== null && task.cancelledOn === undefined) change.cancelledOn = cancelledOn
    const line = lines[at.line]
    if (line === undefined || !Object.keys(change).length) continue
    const ending = line.endsWith('\r') ? '\r' : ''
    lines[at.line] = changedTask(line.slice(0, line.length - ending.length), change) + ending
  }
  return lines.join('\n')
}
