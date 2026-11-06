import { i18n, t } from '../../i18n.svelte'

export function dayOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function timeOf(at: number): string {
  return i18n.when(at, { hour: 'numeric', minute: '2-digit' })
}

export function dayLine(at: number, now = Date.now()): string {
  const day = dayOf(at)
  if (day === dayOf(now)) return t('Today')
  if (day === dayOf(now - 24 * 60 * 60 * 1000)) return t('Yesterday')
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return i18n.when(at, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function laterTimes(now: number): number[] {
  const at = (days: number, hour: number) => {
    const when = new Date(now)
    when.setDate(when.getDate() + days)
    when.setHours(hour, 0, 0, 0)
    return when.getTime()
  }
  const monday = (8 - new Date(now).getDay()) % 7 || 7
  return [now + 60 * 60 * 1000, at(1, 9), at(monday, 9)]
}

export function stretch(count: number, unit: 'hour' | 'day' | 'week'): string {
  try {
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit,
      unitDisplay: 'long',
    }).format(count)
  } catch {
    return new Intl.NumberFormat('en', { style: 'unit', unit, unitDisplay: 'long' }).format(count)
  }
}

export function fullTime(at: number): string {
  return i18n.when(at, { dateStyle: 'full', timeStyle: 'short' })
}
