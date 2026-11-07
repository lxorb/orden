import type { Value } from '@orden/bases'
import { i18n } from '../i18n.svelte'

export const FORMATS = [
  'number',
  'percent',
  'currency:EUR',
  'currency:USD',
  'currency:CHF',
  'currency:GBP',
  'progress',
  'url',
  'email',
  'phone',
] as const

export interface Shown {
  text: string
  href?: string
  share?: number
}

function number(value: number, options: Intl.NumberFormatOptions): string {
  try {
    return i18n.amount(value, options)
  } catch {
    return i18n.amount(value)
  }
}

export function formatted(value: Value, format: string | undefined): Shown | null {
  if (format === undefined || value === null) return null
  if (typeof value === 'number') {
    if (format === 'percent') return { text: number(value, { style: 'percent' }) }
    if (format === 'progress') {
      const share = Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
      return { text: number(share, { style: 'percent' }), share }
    }
    if (format.startsWith('currency:'))
      return { text: number(value, { style: 'currency', currency: format.slice(9) }) }
    if (format === 'number') return { text: number(value, {}) }
    return null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const words = value.trim()
  if (format === 'url')
    return { text: words, href: /^[a-z][a-z0-9+.-]*:/i.test(words) ? words : `https://${words}` }
  if (format === 'email') return { text: words, href: `mailto:${words}` }
  if (format === 'phone') return { text: words, href: `tel:${words.replace(/[^\d+]/g, '')}` }
  return null
}
