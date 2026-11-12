import { localDate } from './region'

export function when(stamp: number, dateStyle: 'short' | 'medium', now = new Date()): string {
  const at = new Date(stamp)
  const today =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()

  return today
    ? localDate(at, { timeStyle: 'short' })
    : localDate(at, { dateStyle, timeStyle: 'short' })
}
