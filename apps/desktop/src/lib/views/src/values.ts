import {
  type DateValue,
  type DurationValue,
  type LinkValue,
  onClock,
  type Value,
} from '@orden/bases'

function kindOf(value: Value | undefined): string | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value))
    return null
  const kind = 'kind' in value ? value.kind : null
  return typeof kind === 'string' ? kind : null
}

export const isDateValue = (value: Value | undefined): value is DateValue =>
  kindOf(value) === 'date' &&
  typeof value === 'object' &&
  value !== null &&
  'iso' in value &&
  typeof value.iso === 'string'

export const isDurationValue = (value: Value | undefined): value is DurationValue =>
  kindOf(value) === 'duration'

export const isLinkValue = (value: Value | undefined): value is LinkValue =>
  kindOf(value) === 'link'

export function dayIn(value: Value | undefined): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return isDateValue(value) ? onClock(value).iso : null
}
