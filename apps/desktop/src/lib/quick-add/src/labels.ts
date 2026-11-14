import { dayWords, timeWords } from '@orden/editor/task-days'
import type { Remind } from '@orden/markdown/task-line'

export { dayWords }

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours} h`)
  if (rest || !hours) parts.push(`${rest} min`)
  return parts.join(' ')
}

export function remindLabel(one: Remind, today: string): string {
  if ('before' in one) return one.before === 0 ? 'At the time' : durationLabel(one.before)
  if ('at' in one) return dayWords(one.at, today, one.time)
  return timeWords(one.time)
}
