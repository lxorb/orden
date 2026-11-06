import { dayWords, timeWords } from '@orden/editor/task-days'
import type { Remind } from '@orden/markdown/task-line'
import { t } from '../i18n.svelte'

export { dayWords }

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (hours) parts.push(t('{count} h', { count: hours }))
  if (rest || !hours) parts.push(t('{count} min', { count: rest }))
  return parts.join(' ')
}

export function remindLabel(one: Remind, today: string): string {
  if ('before' in one) return one.before === 0 ? t('At the time') : durationLabel(one.before)
  if ('at' in one) return dayWords(one.at, today, one.time)
  return timeWords(one.time)
}

export function priorityTone(priority: number): string | undefined {
  return (
    { 1: 'var(--canvas-1)', 2: 'var(--canvas-2)', 3: 'var(--canvas-5)' } as Record<number, string>
  )[priority]
}
