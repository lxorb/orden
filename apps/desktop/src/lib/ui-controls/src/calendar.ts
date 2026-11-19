import { localDate, region } from '../../platform/src/api'

interface CalendarDay {
  iso: string
  day: number
  inMonth: boolean
}
const two = (count: number) => String(count).padStart(2, '0')
const isoOf = (date: Date): string =>
  new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10)
export function dateOf(iso: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!parts) return null
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12)
  return isoOf(date) === iso ? date : null
}
export const todayIso = (now = new Date()): string => isoOf(now)
export function daysAfter(iso: string, days: number): string {
  const date = dateOf(iso) ?? new Date()
  date.setDate(date.getDate() + days)
  return isoOf(date)
}
export function monthsAfter(iso: string, months: number): string {
  const date = dateOf(iso) ?? new Date()
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, last))
  return isoOf(date)
}
export function weekStart(locale = region()): number {
  try {
    const said = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const first = said.getWeekInfo?.().firstDay ?? said.weekInfo?.firstDay
    return first === undefined ? 1 : first % 7
  } catch {
    return 1
  }
}
export function weekBounds(iso: string, first: number): { from: string; to: string } {
  const back = ((dateOf(iso)?.getDay() ?? first) - first + 7) % 7
  return { from: daysAfter(iso, -back), to: daysAfter(iso, 6 - back) }
}
export function monthGrid(iso: string, first: number): CalendarDay[][] {
  const date = dateOf(iso) ?? new Date()
  const month = date.getMonth()
  const opening = isoOf(new Date(date.getFullYear(), month, 1, 12))
  let at = weekBounds(opening, first).from
  const weeks: CalendarDay[][] = []
  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = []
    for (let day = 0; day < 7; day++) {
      const shown = dateOf(at) ?? date
      days.push({ iso: at, day: shown.getDate(), inMonth: shown.getMonth() === month })
      at = daysAfter(at, 1)
    }
    weeks.push(days)
  }
  return weeks
}
export function weekdayNames(first: number): { short: string; long: string }[] {
  const sunday = new Date(2023, 0, 1, 12)
  return Array.from({ length: 7 }, (_, at) => {
    const date = new Date(sunday)
    date.setDate(1 + ((first + at) % 7))
    return { short: localDate(date, { weekday: 'narrow' }), long: localDate(date, { weekday: 'long' }) }
  })
}
export const monthName = (iso: string): string =>
  localDate(dateOf(iso) ?? new Date(), { month: 'long', year: 'numeric' })
export const dayName = (iso: string): string => localDate(dateOf(iso) ?? new Date(), { dateStyle: 'full' })
const NUMERIC: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
export const dateWords = (iso: string): string => {
  const date = dateOf(iso)
  return date ? localDate(date, NUMERIC) : iso
}
function fieldOrder(): ('day' | 'month' | 'year')[] {
  const parts = new Intl.DateTimeFormat(region(), NUMERIC).formatToParts(new Date(2023, 0, 31, 12))
  return parts.flatMap((part) =>
    part.type === 'day' || part.type === 'month' || part.type === 'year' ? [part.type] : [],
  )
}
export function readDate(typed: string, today = todayIso()): string | null {
  const words = typed.trim()
  if (dateOf(words)) return words
  const numbers = words
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number)
  if (numbers.length < 2 || numbers.length > 3) return null
  const order = fieldOrder().filter((one) => numbers.length === 3 || one !== 'year')
  const said: Partial<Record<'day' | 'month' | 'year', number>> = {}
  order.forEach((one, at) => {
    const value = numbers[at]
    if (value !== undefined) said[one] = value
  })
  const thisYear = Number(today.slice(0, 4))
  const year = said.year === undefined ? thisYear : said.year < 100 ? 2000 + said.year : said.year
  const iso = `${String(year).padStart(4, '0')}-${two(said.month ?? 0)}-${two(said.day ?? 0)}`
  return dateOf(iso) ? iso : null
}
export function readClock(typed: string): string | null {
  const words = typed.trim().toLowerCase().replace(/\s+/g, '')
  const parts = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(words)
  if (!parts) return null
  let hours = Number(parts[1])
  const minutes = parts[2] === undefined ? 0 : Number(parts[2])
  const half = parts[3]?.[0]
  if (half) {
    if (hours < 1 || hours > 12) return null
    hours = (hours % 12) + (half === 'p' ? 12 : 0)
  }
  if (hours > 23 || minutes > 59) return null
  return `${two(hours)}:${two(minutes)}`
}
export function clockWords(clock: string): string {
  const parts = /^(\d{2}):(\d{2})/.exec(clock)
  if (!parts) return clock
  return localDate(new Date(2023, 0, 1, Number(parts[1]), Number(parts[2])), { hour: 'numeric', minute: '2-digit' })
}
export function clockAfter(clock: string, minutes: number): string {
  const parts = /^(\d{2}):(\d{2})/.exec(clock)
  const now = parts ? Number(parts[1]) * 60 + Number(parts[2]) : 0
  const next = (((now + minutes) % 1440) + 1440) % 1440
  return `${two(Math.floor(next / 60))}:${two(next % 60)}`
}
export function dayWords(iso: string, today = todayIso(), weekday: 'long' | 'short' = 'long'): string {
  const date = dateOf(iso)
  if (!date) return iso
  const away = Math.round((date.getTime() - (dateOf(today)?.getTime() ?? date.getTime())) / 86_400_000)
  if (away === 0) return 'Today'
  if (away === 1) return 'Tomorrow'
  if (away === -1) return 'Yesterday'
  if (away > 1 && away < 7) return localDate(date, { weekday })
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return localDate(
    date,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  )
}
