import { addDays, weekday } from '@orden/bases'

const two = (value: number) => String(value).padStart(2, '0')

export function dayOf(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

export function nowOf(at: Date): string {
  return `${dayOf(at)}T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

export function nextMonday(day: string): string {
  const offset = (8 - weekday(day)) % 7 || 7
  return addDays(day, offset)
}

export function weekStart(day: string, first: number): string {
  return addDays(day, -((weekday(day) - first + 7) % 7))
}

export const todayHere = (): string => dayOf(new Date())

export const nowHere = (): string => nowOf(new Date())

export function dateAt(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}
