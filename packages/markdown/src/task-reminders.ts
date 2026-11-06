import { heldEscapes, released } from './escapes'
import { type DueReads, startOf } from './task-dates'
import type { TaskFields } from './task-line'

export interface WallTime {
  date: string
  time: string
  zone?: string
  before?: { date: string; time: string; minutes: number }
  twin?: true
}

const MINUTE = 60_000
const DAY = 86_400_000

export function taskDay(task: TaskFields, due: DueReads = 'start'): string | undefined {
  return startOf(task, due) ?? task.scheduled
}

export function remindTimes(
  task: TaskFields,
  auto: number | null,
  due: DueReads = 'start',
  reader?: string,
): WallTime[] {
  if (task.done || task.cancelled) return []

  const day = taskDay(task, due)
  const zone = task.zone
  const at = (date: string, time: string): WallTime =>
    zone ? { date, time, zone } : { date, time }
  const found: WallTime[] = []

  for (const one of task.remind) {
    if ('at' in one) found.push(at(one.at, one.time))
    else if ('time' in one) {
      if (day) found.push(at(day, one.time))
    } else if (day && task.time) {
      found.push(before(at(day, task.time), one.before))
    }
  }
  if (auto !== null && day && task.time) found.push(before(at(day, task.time), auto))

  const seen = new Map<string, WallTime[]>()
  const once = found.filter((one) => {
    const key = `${one.date} ${one.time}`
    const same = seen.get(key)
    if (!same) {
      seen.set(key, [one])
      return true
    }
    const moment = momentOf(one, reader)
    if (same.some((other) => Object.is(momentOf(other, reader), moment))) return false
    same.push(one)
    return true
  })

  return once
    .map((one) =>
      one.before && (seen.get(`${one.date} ${one.time}`)?.length ?? 0) > 1
        ? { ...one, twin: true as const }
        : one,
    )
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
}

function before(wall: WallTime, minutes: number): WallTime {
  if (minutes <= 0) return wall
  const [hours = 0, mins = 0] = wall.time.split(':').map(Number)
  const [year = 1970, month = 1, day = 1] = wall.date.split('-').map(Number)
  const moment = new Date(Date.UTC(year, month - 1, day, hours, mins) - minutes * MINUTE)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  const date = `${pad(moment.getUTCFullYear(), 4)}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`
  const time = `${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())}`
  const from = { date: wall.date, time: wall.time, minutes }
  return wall.zone ? { date, time, zone: wall.zone, before: from } : { date, time, before: from }
}

export function momentOf(wall: WallTime, zone?: string): number {
  if (wall.before) {
    const { date, time, minutes } = wall.before
    const from = wall.zone ? { date, time, zone: wall.zone } : { date, time }
    return momentOf(from, zone) - minutes * MINUTE
  }

  const [hours, minutes] = wall.time.split(':').map(Number)
  const [year, month, day] = wall.date.split('-').map(Number)
  if ([hours, minutes, year, month, day].some((one) => one === undefined || Number.isNaN(one))) {
    return NaN
  }
  const named = wall.zone ?? zone
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0)
  if (!named) {
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0).getTime()
  }

  const early = offsetOf(named, utc - DAY)
  const late = offsetOf(named, utc + DAY)
  if (Number.isNaN(early) || Number.isNaN(late)) return NaN
  const first = utc - early
  if (early === late) return first

  return offsetOf(named, first) !== early && offsetOf(named, utc - late) === late
    ? utc - late
    : first
}

function offsetOf(zone: string, moment: number): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = formatter(zone).formatToParts(new Date(moment))
  } catch {
    return NaN
  }
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? NaN)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  )
  return wall - Math.floor(moment / 1000) * 1000
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let made = formatters.get(zone)
  if (!made) {
    made = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, made)
  }
  return made
}

export function reminderId(space: string, path: string, hash: string, wall: WallTime): string {
  let value = 0xcbf29ce484222325n
  const minute = `${wall.date} ${wall.time}${wall.twin ? ' counted' : ''}`
  const key = [space, path, hash, minute].join('\n')
  for (const byte of new TextEncoder().encode(key)) {
    value ^= BigInt(byte)
    value = (value * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return value.toString(16).padStart(16, '0')
}

export function plainWords(text: string): string {
  const held = heldEscapes(text)
  return released(
    held
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.replace(/#.*$/, ''))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|~~|==|`)/g, '')
      .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}
