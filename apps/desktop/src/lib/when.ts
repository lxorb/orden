import { i18n } from './i18n.svelte'

export function when(stamp: number, dateStyle: 'short' | 'medium', now = new Date()): string {
  const at = new Date(stamp)
  const today =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()

  return today
    ? i18n.when(at, { timeStyle: 'short' })
    : i18n.when(at, { dateStyle, timeStyle: 'short' })
}
