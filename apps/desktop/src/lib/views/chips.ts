import type { Value } from '@orden/bases'
import { localNumber } from '../region'
import { isDateValue, isDurationValue, isLinkValue } from './values'
import { dayWords } from '@orden/editor/task-days'

function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${localNumber(rest)}m`
  return rest ? `${localNumber(hours)}h ${localNumber(rest)}m` : `${localNumber(hours)}h`
}

export function valueText(value: Value, today: string): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return localNumber(value)
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (Array.isArray(value))
    return value
      .map((one) => valueText(one, today))
      .filter(Boolean)
      .join(', ')
  if (isDateValue(value)) return dayWords(value.iso, today, value.time?.slice(0, 5))
  if (isDurationValue(value)) return minutesText(Math.round(value.ms / 60_000))
  if (isLinkValue(value))
    return value.display ?? (value.target.split('/').pop() ?? value.target).replace(/\.md$/i, '')
  if ('kind' in value && 'name' in value && typeof value.name === 'string') return value.name
  if ('kind' in value && 'src' in value && typeof value.src === 'string') return value.src
  return ''
}

export function toneColour(tone: string | undefined): string | null {
  switch (tone) {
    case undefined:
      return null
    case 'danger':
    case 'red':
    case '1':
      return 'var(--canvas-1)'
    case 'warning':
    case 'orange':
    case '2':
      return 'var(--canvas-2)'
    case 'yellow':
    case '3':
      return 'var(--canvas-3)'
    case 'success':
    case 'green':
    case '4':
      return 'var(--canvas-4)'
    case 'info':
    case 'cyan':
    case '5':
      return 'var(--canvas-5)'
    case 'purple':
    case '6':
      return 'var(--canvas-6)'
    default:
      return null
  }
}
