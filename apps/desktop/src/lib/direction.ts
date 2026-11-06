export const RIGHT_TO_LEFT: readonly string[] = ['ar', 'fa', 'ps', 'ur']

export type Direction = 'ltr' | 'rtl'

export function directionOf(language: string): Direction {
  const base = language.split('-')[0]?.toLowerCase() ?? ''
  return RIGHT_TO_LEFT.includes(base) ? 'rtl' : 'ltr'
}

export function factorOf(direction: Direction): number {
  return direction === 'rtl' ? -1 : 1
}

export function reading(): Direction {
  if (typeof document === 'undefined') return 'ltr'
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
}

export function readingFactor(): number {
  return factorOf(reading())
}

export function steppedKey(key: string): string {
  if (reading() === 'ltr') return key
  if (key === 'ArrowLeft') return 'ArrowRight'
  if (key === 'ArrowRight') return 'ArrowLeft'
  return key
}

const RIGHT_TO_LEFT_LETTER = /[\u0590-\u05ff\u0600-\u07bf\u0860-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/
const LEFT_TO_RIGHT_LETTER = /[A-Za-z\u00c0-\u02af\u0370-\u052f]/

export function isolated(value: string, direction: Direction): string {
  const otherWay =
    direction === 'rtl' ? LEFT_TO_RIGHT_LETTER.test(value) : RIGHT_TO_LEFT_LETTER.test(value)
  return otherWay ? `\u2068${value}\u2069` : value
}
