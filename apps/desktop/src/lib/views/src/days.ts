import { todayOf } from '@orden/bases'

const two = (value: number) => String(value).padStart(2, '0')

const nowOf = (at: Date): string =>
  `${todayOf(at)}T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`

export const todayHere = (): string => todayOf()
export const nowHere = (): string => nowOf(new Date())

export function dateAt(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}
