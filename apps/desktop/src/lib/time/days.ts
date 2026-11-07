import type { Span } from './records'

export const HOUR = 3_600_000

export const MINUTE = 60_000

export const counts = (ms: number): boolean => ms >= MINUTE / 2

export type Range = 'day' | 'week' | 'month'

export interface Piece {
  span: Span
  from: number
  to: number
}

export interface Total {
  activity: string | null
  ms: number
}

export function dayOf(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function daysAfter(day: number, count: number): number {
  const date = new Date(day)
  date.setDate(date.getDate() + count)
  return dayOf(date.getTime())
}

export function startOf(range: Range, at: number): number {
  const date = new Date(dayOf(at))
  if (range === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  if (range === 'month') date.setDate(1)
  return date.getTime()
}

export function endOf(range: Range, start: number): number {
  if (range === 'day') return daysAfter(start, 1)
  if (range === 'week') return daysAfter(start, 7)
  const date = new Date(start)
  date.setMonth(date.getMonth() + 1)
  return date.getTime()
}

export function stepped(range: Range, start: number, by: number): number {
  if (range === 'day') return daysAfter(start, by)
  if (range === 'week') return daysAfter(start, 7 * by)
  const date = new Date(start)
  date.setMonth(date.getMonth() + by)
  return date.getTime()
}

export function piecesIn(spans: readonly Span[], from: number, to: number, now: number): Piece[] {
  const out: Piece[] = []
  for (const span of spans) {
    const end = span.end ?? Math.max(now, span.start)
    const cut = { span, from: Math.max(span.start, from), to: Math.min(end, to) }
    if (cut.to > cut.from || (span.end === null && span.start >= from && span.start < to)) {
      out.push(cut)
    }
  }
  return out.sort((one, other) => one.from - other.from)
}

function covered(pieces: readonly Piece[]): number {
  const sorted = [...pieces].sort((one, other) => one.from - other.from)
  let ms = 0
  let reach = -Infinity
  for (const piece of sorted) {
    if (piece.to <= reach) continue
    ms += piece.to - Math.max(piece.from, reach)
    reach = piece.to
  }
  return ms
}

export function totalsOf(pieces: readonly Piece[]): Total[] {
  const by = new Map<string | null, Piece[]>()
  for (const piece of pieces) {
    const list = by.get(piece.span.activity) ?? []
    list.push(piece)
    by.set(piece.span.activity, list)
  }
  return [...by]
    .map(([activity, list]) => ({ activity, ms: covered(list) }))
    .filter((one) => counts(one.ms))
    .sort((one, other) => other.ms - one.ms)
}

export function wholeOf(pieces: readonly Piece[]): number {
  return covered(pieces)
}

export function lasting(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function ticking(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  const rest = String(seconds % 60).padStart(2, '0')
  return `${lasting(seconds * 1000)}:${rest}`
}

export function atClock(day: number, clock: string): number | null {
  const found = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!found) return null
  const hours = Number(found[1])
  const minutes = Number(found[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  const date = new Date(day)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

export function clockOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
