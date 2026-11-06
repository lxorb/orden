import {
  addDays,
  civil,
  dayNumber,
  daysInMonth,
  fromDayNumber,
  isoOf,
  monthName,
  weekday,
  weekdayName,
} from './dates'

export interface Rule {
  every: number
  unit: 'day' | 'week' | 'month' | 'year'
  weekdays: { day: number; nth?: number }[]
  monthDays: number[]
  months: number[]
  whenDone: boolean
  until?: string
  count?: number
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const MONTH_NAMES: Record<string, number> = {}
for (let month = 1; month <= 12; month++) {
  const name = monthName(month).toLowerCase()
  MONTH_NAMES[name] = month
  MONTH_NAMES[name.slice(0, 3)] = month
}
MONTH_NAMES.sept = 9

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  other: 2,
}

function ordinal(word: string): number | null {
  const found = /^(\d+)(?:st|nd|rd|th)?$/.exec(word)
  if (found) return Number(found[1])
  const named = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(word)
  return named === -1 ? null : named + 1
}

function readUntil(words: string): string | null {
  const text = words.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (civil(text)) return text
  const parts = text.split(' ')
  let year: number | null = null
  let month: number | null = null
  let day: number | null = null
  for (const part of parts) {
    const asMonth = MONTH_NAMES[part]
    if (asMonth !== undefined) month = asMonth
    else if (/^\d{4}$/.test(part)) year = Number(part)
    else if (ordinal(part) !== null) day = ordinal(part)
  }
  if (year === null || month === null || day === null || day > daysInMonth(year, month)) return null
  return isoOf(year, month, day)
}

export function parseRule(written: string): Rule | null {
  let text = written.trim().toLowerCase().replace(/\s+/g, ' ')
  const rule: Rule = {
    every: 1,
    unit: 'day',
    weekdays: [],
    monthDays: [],
    months: [],
    whenDone: false,
  }

  if (text.endsWith(' when done')) {
    rule.whenDone = true
    text = text.slice(0, -' when done'.length)
  }
  if (text.startsWith('every!')) {
    rule.whenDone = true
    text = `every ${text.slice('every!'.length)}`
  }

  const count = / for (\d+) times?$/.exec(text)
  if (count) {
    rule.count = Number(count[1])
    text = text.slice(0, count.index)
  }
  const until = / until (.+)$/.exec(text)
  if (until) {
    const date = readUntil(until[1] ?? '')
    if (!date) return null
    rule.until = date
    text = text.slice(0, until.index)
  }

  const words = text.replace(/,/g, ' , ').split(' ').filter(Boolean)
  if (words.shift() !== 'every') return null

  let at = 0
  const peek = () => words[at] ?? ''
  const take = () => words[at++] ?? ''

  const amount = WORDS[peek()] ?? (/^\d+$/.test(peek()) ? Number(peek()) : null)
  if (amount !== null) {
    rule.every = amount
    at++
  }
  if (rule.every < 1) return null

  const unit = take()
  switch (unit.replace(/s$/, '')) {
    case 'day':
      rule.unit = 'day'
      break
    case 'week':
      rule.unit = 'week'
      break
    case 'month':
      rule.unit = 'month'
      break
    case 'year':
      rule.unit = 'year'
      break
    case 'weekday':
    case 'workday':
      rule.unit = 'week'
      rule.weekdays = [1, 2, 3, 4, 5].map((day) => ({ day }))
      break
    case 'weekend':
      rule.unit = 'week'
      rule.weekdays = [6, 0].map((day) => ({ day }))
      break
    default: {
      at--
      if (DAY_NAMES[peek()] !== undefined) {
        rule.unit = 'week'
        rule.weekdays = readWeekdays()
      } else if (MONTH_NAMES[peek()] !== undefined) {
        rule.unit = 'year'
        rule.months = readMonths()
      } else {
        return null
      }
    }
  }

  function readWeekdays(): { day: number; nth?: number }[] {
    const out: { day: number; nth?: number }[] = []
    while (at < words.length) {
      const day = DAY_NAMES[peek().replace(/s$/, '')] ?? DAY_NAMES[peek()]
      if (day === undefined) break
      out.push({ day })
      at++
      if (peek() === ',' || peek() === 'and') at++
    }
    return out
  }

  function readMonths(): number[] {
    const out: number[] = []
    while (MONTH_NAMES[peek()] !== undefined) {
      out.push(MONTH_NAMES[take()] ?? 1)
      if (peek() === ',' || peek() === 'and') at++
    }
    return out
  }

  if (rule.unit === 'year' && peek() === 'in' && MONTH_NAMES[words[at + 1] ?? ''] !== undefined) {
    at++
    rule.months = readMonths()
  }

  if (peek() === 'on') {
    at++
    if (peek() === 'the') {
      at++
      if (!readOnThe()) return null
    } else if (DAY_NAMES[peek()] !== undefined) {
      rule.weekdays = readWeekdays()
    } else if (ordinal(peek()) !== null && MONTH_NAMES[words[at + 1] ?? ''] !== undefined) {
      rule.monthDays = [ordinal(take()) ?? 1]
      rule.months = [MONTH_NAMES[take()] ?? 1]
    } else if (MONTH_NAMES[peek()] !== undefined && ordinal(words[at + 1] ?? '') !== null) {
      rule.months = [MONTH_NAMES[take()] ?? 1]
      rule.monthDays = [ordinal(take()) ?? 1]
    } else {
      return null
    }
  }

  function readOnThe(): boolean {
    if (at >= words.length) return false
    while (at < words.length) {
      let nth = ordinal(peek())
      if (nth !== null) at++
      if (peek() === 'last') {
        at++
        nth = -(nth ?? 1)
      }
      if (nth === null) return false
      const day = DAY_NAMES[peek()]
      if (day !== undefined) {
        at++
        rule.weekdays.push({ day, nth })
      } else {
        rule.monthDays.push(nth)
      }
      if (peek() === ',' || peek() === 'and') {
        at++
        if (peek() === 'the') at++
        continue
      }
      break
    }
    return true
  }

  if (at < words.length) return null
  return rule
}

function nthText(nth: number): string {
  if (nth === -1) return 'last'
  if (nth < 0) return `${nthText(-nth)} last`
  const tens = nth % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][nth % 10] ?? 'th')
  return `${nth}${suffix}`
}

const sameDays = (a: readonly { day: number; nth?: number }[], days: readonly number[]) =>
  a.length === days.length && a.every((one) => one.nth === undefined && days.includes(one.day))

const mondayFirst = (day: number) => (day + 6) % 7

function joined(parts: readonly string[], last = ' and '): string {
  return parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')}${last}${parts.at(-1) ?? ''}`
}

function untilText(iso: string): string {
  const parts = civil(iso)
  return parts ? `${monthName(parts.month)} ${parts.day}, ${parts.year}` : iso
}

export function ruleText(rule: Rule): string {
  const plural = (unit: string) =>
    rule.every === 1 ? `every ${unit}` : `every ${rule.every} ${unit}s`
  let text: string

  const onDays = () => {
    const parts = [
      ...rule.monthDays.map((day) => nthText(day)),
      ...rule.weekdays.map(
        (one) => `${one.nth === undefined ? '' : `${nthText(one.nth)} `}${weekdayName(one.day)}`,
      ),
    ]
    return parts.length ? ` on the ${joined(parts)}` : ''
  }

  if (rule.unit === 'week' && rule.every === 1 && sameDays(rule.weekdays, [1, 2, 3, 4, 5])) {
    text = 'every weekday'
  } else if (rule.unit === 'week') {
    const days = [...rule.weekdays].sort((a, b) => mondayFirst(a.day) - mondayFirst(b.day))
    text =
      plural('week') +
      (days.length ? ` on ${days.map((one) => weekdayName(one.day)).join(', ')}` : '')
  } else if (rule.unit === 'year' && rule.months.length) {
    const months = joined(rule.months.map(monthName))
    text =
      (rule.every === 1 ? `every ${months}` : `every ${rule.every} years in ${months}`) + onDays()
  } else {
    text = plural(rule.unit) + onDays()
  }

  if (rule.until) text += ` until ${untilText(rule.until)}`
  if (rule.count !== undefined) text += ` for ${rule.count} times`
  if (rule.whenDone) text += ' when done'
  return text
}

function daysIn(
  rule: Rule,
  year: number,
  month: number,
  fallback: number,
  clamp: boolean,
): number[] {
  const length = daysInMonth(year, month)
  const days = new Set<number>()

  for (const day of rule.monthDays) {
    const actual = day < 0 ? length + day + 1 : day
    if (actual >= 1 && actual <= length) days.add(actual)
  }
  for (const { day, nth } of rule.weekdays) {
    const first = weekday(isoOf(year, month, 1))
    const firstOf = 1 + ((day - first + 7) % 7)
    const all: number[] = []
    for (let one = firstOf; one <= length; one += 7) all.push(one)
    if (nth === undefined) all.forEach((one) => days.add(one))
    else {
      const picked = nth > 0 ? all[nth - 1] : all[all.length + nth]
      if (picked !== undefined) days.add(picked)
    }
  }
  if (!rule.monthDays.length && !rule.weekdays.length) {
    if (fallback <= length) days.add(fallback)
    else if (clamp) days.add(length)
  }
  return [...days].sort((a, b) => a - b)
}

function candidates(rule: Rule, start: string, period: number): string[] {
  const parts = civil(start)
  if (!parts) return []
  const step = period * rule.every

  switch (rule.unit) {
    case 'day': {
      const date = addDays(start, step)
      return !rule.weekdays.length || rule.weekdays.some((one) => one.day === weekday(date))
        ? [date]
        : []
    }
    case 'week': {
      const monday = dayNumber(start) - mondayFirst(weekday(start)) + step * 7
      const days = rule.weekdays.length ? rule.weekdays.map((one) => one.day) : [weekday(start)]
      return [...new Set(days.map(mondayFirst))]
        .sort((a, b) => a - b)
        .map((offset) => fromDayNumber(monday + offset))
    }
    case 'month': {
      const index = parts.year * 12 + parts.month - 1 + step
      const year = Math.floor(index / 12)
      const month = index - year * 12 + 1
      return daysIn(rule, year, month, parts.day, true).map((day) => isoOf(year, month, day))
    }
    case 'year': {
      const year = parts.year + step
      const months = rule.months.length ? [...rule.months].sort((a, b) => a - b) : [parts.month]
      const clamp = !rule.months.length && !rule.monthDays.length && !rule.weekdays.length
      return months.flatMap((month) =>
        daysIn(rule, year, month, parts.day, clamp).map((day) => isoOf(year, month, day)),
      )
    }
  }
}

function periodsBetween(rule: Rule, from: string, to: string): number {
  const days = dayNumber(to) - dayNumber(from)
  const size = { day: 1, week: 7, month: 31, year: 366 }[rule.unit] * rule.every
  return Math.max(0, Math.floor(days / size) - 1)
}

const MOST_PERIODS = 2000

export function nextDate(rule: Rule, start: string, after: string): string | null {
  const first = after < start ? 0 : periodsBetween(rule, start, after)
  for (let period = first; period < first + MOST_PERIODS; period++) {
    for (const date of candidates(rule, start, period)) {
      if (date < start || date <= after) continue
      if (rule.until && date > rule.until) return null
      return date
    }
  }
  return null
}
