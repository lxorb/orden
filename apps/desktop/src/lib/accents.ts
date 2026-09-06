/** The accent colours a person can pick, the way GNOME offers a row of them.
 *  Each carries its own shade per scheme, because a colour bright enough to
 *  read on black is usually too pale on white. */

export interface Accent {
  id: string
  name: string
  dark: string
  light: string
}

export const ACCENTS: Accent[] = [
  { id: 'violet', name: 'Violet', dark: '#7c6bf5', light: '#5b4be0' },
  { id: 'blue', name: 'Blue', dark: '#3584e4', light: '#1c71d8' },
  { id: 'teal', name: 'Teal', dark: '#33c7ba', light: '#0f9b8e' },
  { id: 'green', name: 'Green', dark: '#3fcf8e', light: '#1a8f5c' },
  { id: 'yellow', name: 'Yellow', dark: '#e5b23c', light: '#a26c07' },
  { id: 'orange', name: 'Orange', dark: '#f08437', light: '#c64600' },
  { id: 'red', name: 'Red', dark: '#f2555a', light: '#c01c28' },
  { id: 'pink', name: 'Pink', dark: '#e56ba8', light: '#c4287f' },
  { id: 'slate', name: 'Slate', dark: '#8aa0b8', light: '#5b6b7f' },
]

export const DEFAULT_ACCENT = 'violet'

export function accentById(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0]
}

/** `#rrggbb` to its three channels. */
export function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((one) => Math.round(one).toString(16).padStart(2, '0')).join('')}`
}

/** Moves a colour toward white or black, for the hover shade. */
export function shift(hex: string, towards: 'light' | 'dark', amount = 0.14): string {
  const target = towards === 'light' ? 255 : 0
  return toHex(
    channels(hex).map((one) => one + (target - one) * amount) as [number, number, number],
  )
}

/** Every token that depends on the accent, so one choice restyles the app. */
export function accentTokens(id: string, scheme: 'dark' | 'light'): Record<string, string> {
  const base = accentById(id)[scheme]
  const [r, g, b] = channels(base)

  return {
    '--accent': base,
    // Hover moves away from the background, whichever way that is.
    '--accent-hover': shift(base, scheme === 'dark' ? 'light' : 'dark'),
    '--accent-soft': `rgb(${r} ${g} ${b} / ${scheme === 'dark' ? 0.15 : 0.1})`,
    '--accent-line': `rgb(${r} ${g} ${b} / ${scheme === 'dark' ? 0.42 : 0.38})`,
    '--selection': `rgb(${r} ${g} ${b} / ${scheme === 'dark' ? 0.28 : 0.18})`,
  }
}
