import type { DateValue } from './types'

const DAY = 86_400_000

export interface Civil {
  year: number
  month: number
  day: number
}

export function civil(iso: string): Civil | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!found) return null
  const parts = { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1) return null
  if (parts.day > daysInMonth(parts.year, parts.month)) return null
  return parts
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

export function isoOf(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function dayNumber(iso: string): number {
  const known = dayNumbers.get(iso)
  if (known !== undefined) return known
  const parts = civil(iso)
  const days = parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / DAY : NaN
  if (dayNumbers.size >= MOST_DAYS) dayNumbers.clear()
  dayNumbers.set(iso, days)
  return days
}

const dayNumbers = new Map<string, number>()
const MOST_DAYS = 20_000

export function fromDayNumber(days: number): string {
  const date = new Date(days * DAY)
  return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days)
}

export function addMonths(iso: string, months: number): string {
  const parts = civil(iso)
  if (!parts) return iso
  const index = parts.year * 12 + parts.month - 1 + months
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  return isoOf(year, month, Math.min(parts.day, daysInMonth(year, month)))
}

export function weekday(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7
}

export function msOf(value: DateValue): number {
  const day = dayNumber(value.iso) * DAY
  if (!value.time) return day
  const [hours = 0, minutes = 0, seconds = 0] = value.time.split(':').map(Number)
  return day + ((hours * 60 + minutes) * 60 + Math.floor(seconds)) * 1000 + millisOf(value.time)
}

function millisOf(time: string): number {
  const found = /\.(\d{1,3})/.exec(time)
  return found?.[1] ? Number(found[1].padEnd(3, '0')) : 0
}

export function dateAt(ms: number, dateOnly = false): DateValue {
  const date = new Date(ms)
  const iso = isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  if (dateOnly) return { kind: 'date', iso }
  const millis = date.getUTCMilliseconds()
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  return { kind: 'date', iso, time: millis ? `${time}.${pad(millis, 3)}` : time }
}

export function wallClock(epochMs: number): number {
  const date = new Date(epochMs)
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  )
}

export function readDate(text: string): DateValue | null {
  const found = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?(Z)?$/.exec(
    text.trim(),
  )
  if (!found?.[1] || !civil(found[1])) return null
  if (found[2] === undefined) return { kind: 'date', iso: found[1] }
  const time = `${pad(Number(found[2]))}:${found[3] ?? '00'}:${found[4] ?? '00'}${found[5] ?? ''}`
  return { kind: 'date', iso: found[1], time }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? ''
}

export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? ''
}

function ordinal(value: number): string {
  const tens = value % 100
  if (tens >= 11 && tens <= 13) return `${value}th`
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`
}

function isoWeek(iso: string): number {
  const day = dayNumber(iso)
  const thursday = day - ((weekday(iso) + 6) % 7) + 3
  const year = new Date(thursday * DAY).getUTCFullYear()
  return Math.floor((thursday - dayNumber(isoOf(year, 1, 1))) / 7) + 1
}

const TOKENS =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DDDD|DD|D|dddd|ddd|dd|d|E|e|HH|H|hh|h|mm|m|ss|s|SSS|A|a|WW|W|ww|w|X|x|Q/g

export function formatDate(value: DateValue, format: string): string {
  const ms = msOf(value)
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const seconds = date.getUTCSeconds()
  const day7 = date.getUTCDay()
  const hours12 = hours % 12 === 0 ? 12 : hours % 12

  return format.replace(TOKENS, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'YYYY':
        return pad(year, 4)
      case 'YY':
        return pad(year % 100)
      case 'MMMM':
        return monthName(month)
      case 'MMM':
        return monthName(month).slice(0, 3)
      case 'MM':
        return pad(month)
      case 'M':
        return String(month)
      case 'Do':
        return ordinal(day)
      case 'DDDD':
        return pad(dayNumber(value.iso) - dayNumber(isoOf(year, 1, 1)) + 1, 3)
      case 'DD':
        return pad(day)
      case 'D':
        return String(day)
      case 'dddd':
        return weekdayName(day7)
      case 'ddd':
        return weekdayName(day7).slice(0, 3)
      case 'dd':
        return weekdayName(day7).slice(0, 2)
      case 'd':
      case 'e':
        return String(day7)
      case 'E':
        return String(day7 === 0 ? 7 : day7)
      case 'HH':
        return pad(hours)
      case 'H':
        return String(hours)
      case 'hh':
        return pad(hours12)
      case 'h':
        return String(hours12)
      case 'mm':
        return pad(minutes)
      case 'm':
        return String(minutes)
      case 'ss':
        return pad(seconds)
      case 's':
        return String(seconds)
      case 'SSS':
        return pad(date.getUTCMilliseconds(), 3)
      case 'A':
        return hours < 12 ? 'AM' : 'PM'
      case 'a':
        return hours < 12 ? 'am' : 'pm'
      case 'WW':
      case 'ww':
        return pad(isoWeek(value.iso))
      case 'W':
      case 'w':
        return String(isoWeek(value.iso))
      case 'X':
        return String(Math.floor(ms / 1000))
      case 'x':
        return String(ms)
      case 'Q':
        return String(Math.ceil(month / 3))
      default:
        return token
    }
  })
}

export function relative(ms: number, now: number): string {
  const seconds = Math.round(Math.abs(ms - now) / 1000)
  const minutes = Math.round(seconds / 60)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  const months = Math.round(days / 30.4375)
  const years = Math.round(days / 365.25)

  let words: string
  if (seconds < 45) words = 'a few seconds'
  else if (seconds < 90) words = 'a minute'
  else if (minutes < 45) words = `${minutes} minutes`
  else if (minutes < 90) words = 'an hour'
  else if (hours < 22) words = `${hours} hours`
  else if (hours < 36) words = 'a day'
  else if (days < 26) words = `${days} days`
  else if (days < 46) words = 'a month'
  else if (days < 320) words = `${months} months`
  else if (days < 548) words = 'a year'
  else words = `${years} years`

  return ms <= now ? `${words} ago` : `in ${words}`
}

export function todayOf(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate())
}
