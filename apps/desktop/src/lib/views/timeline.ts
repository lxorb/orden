import { addDays, dayNumber, type Row, type Value } from '@orden/bases'
import { deadlineOf, startOf } from '@orden/markdown/task-dates'
import { dayIn, isDateValue } from './values'

export type Scale = 'day' | 'week' | 'month' | 'quarter'
export const SCALES: readonly Scale[] = ['day', 'week', 'month', 'quarter']

export const DAY_WIDTH: Record<Scale, number> = { day: 36, week: 14, month: 4.5, quarter: 1.6 }

export interface Bar {
  row: Row
  start: string
  end: string
  from: string
  to: string
  fromTime?: string
  toTime?: string
}

function timeIn(value: Value): string {
  if (typeof value === 'string') return value.slice(10)
  if (!isDateValue(value) || !value.time) return ''
  return `T${value.time.replace(/:00$/, '')}${value.zone ?? ''}`
}

export function barOf(
  row: Row,
  dates: { start?: string | undefined; end?: string | undefined },
  read: (row: Row, property: string) => Value,
): Bar | null {
  if (row.task && !dates.start) {
    const task = row.task
    const begins = startOf(task, task.dueReads)
    const deadline = deadlineOf(task, task.dueReads)
    const from = begins
      ? 'task.start'
      : task.scheduled
        ? 'task.scheduled'
        : deadline
          ? 'task.deadline'
          : null
    if (from === null) return null
    const start = begins ?? task.scheduled ?? deadline ?? ''
    const to = deadline && from !== 'task.deadline' ? 'task.deadline' : from
    let end = deadline && from !== 'task.deadline' ? deadline : start
    if (end < start) end = start
    return { row, start, end, from, to }
  }

  const fromProperty = dates.start ?? 'file.ctime'
  const startValue = read(row, fromProperty)
  const start = dayIn(startValue)
  if (start === null) return null
  const toProperty = dates.end ?? fromProperty
  const endValue = read(row, toProperty)
  const endRead = dayIn(endValue)
  const end = endRead !== null && endRead >= start ? endRead : start
  return {
    row,
    start,
    end,
    from: fromProperty,
    to: toProperty,
    fromTime: timeIn(startValue),
    toTime: endRead === null ? '' : timeIn(endValue),
  }
}

const FURTHEST = 3650

export function spanOf(bars: readonly Bar[], today: string): { first: string; last: string } {
  const starts = bars.map((bar) => bar.start).sort()
  const middle = starts[Math.floor(starts.length / 2)] ?? today
  const earliest = addDays(middle, -FURTHEST)
  const latest = addDays(middle, FURTHEST)
  const around = today >= earliest && today <= latest ? today : middle
  let first = addDays(around, -7)
  let last = addDays(around, 28)
  for (const bar of bars) {
    if (bar.start < first && bar.start >= earliest) first = addDays(bar.start, -3)
    if (bar.end > last && bar.end <= latest) last = addDays(bar.end, 7)
  }
  return { first, last }
}

export function drawnOf(
  bar: Bar,
  span: { first: string; last: string },
): { start: string; end: string; far: boolean } {
  const start = bar.start < span.first ? span.first : bar.start > span.last ? span.last : bar.start
  const end = bar.end > span.last ? span.last : bar.end < span.first ? span.first : bar.end
  return { start, end, far: start !== bar.start || end !== bar.end }
}

export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from)

export function dragged(
  bar: Bar,
  part: 'move' | 'start' | 'end',
  days: number,
): Record<string, string> {
  if (!days) return {}
  const { fromTime = '', toTime = '' } = bar
  if (part === 'move') {
    const out: Record<string, string> = { [bar.from]: `${addDays(bar.start, days)}${fromTime}` }
    if (bar.to !== bar.from) out[bar.to] = `${addDays(bar.end, days)}${toTime}`
    return out
  }
  if (part === 'start') {
    const start = addDays(bar.start, days)
    const field =
      bar.from === bar.to && bar.row.task && bar.from === 'task.deadline' ? 'task.start' : bar.from
    return { [field]: `${start > bar.end ? bar.end : start}${fromTime}` }
  }
  const end = addDays(bar.end, days)
  return { [bar.to]: `${end < bar.start ? bar.start : end}${toTime}` }
}

export interface Arrow {
  from: { bar: Bar; at: number }
  to: { bar: Bar; at: number }
}

export function arrowsOf(bars: readonly Bar[]): Arrow[] {
  const byId = new Map<string, { bar: Bar; at: number }>()
  bars.forEach((bar, at) => {
    if (bar.row.task?.id) byId.set(bar.row.task.id, { bar, at })
  })
  const out: Arrow[] = []
  bars.forEach((bar, at) => {
    for (const id of bar.row.task?.dependsOn ?? []) {
      const blocker = byId.get(id)
      if (blocker) out.push({ from: blocker, to: { bar, at } })
    }
  })
  return out
}
