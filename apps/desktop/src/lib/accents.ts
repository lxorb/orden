/** The accent colours a person can pick, the way GNOME offers a row of them.
 *  Each carries its own shade per scheme, because a colour bright enough to
 *  read on black is usually too pale on white. */

export interface Accent {
  id: string
  name: string
  dark: string
  light: string
}

/** The one every fallback lands on, named rather than reached for by index:
 *  the list is data, and `ACCENTS[0]` promises an order it does not have. */
const VIOLET: Accent = { id: 'violet', name: 'Violet', dark: '#7c6bf5', light: '#5b4be0' }

export const ACCENTS: Accent[] = [
  VIOLET,
  { id: 'blue', name: 'Blue', dark: '#3584e4', light: '#1c71d8' },
  { id: 'teal', name: 'Teal', dark: '#33c7ba', light: '#0f9b8e' },
  { id: 'green', name: 'Green', dark: '#3fcf8e', light: '#1a8f5c' },
  { id: 'yellow', name: 'Yellow', dark: '#e5b23c', light: '#a26c07' },
  { id: 'orange', name: 'Orange', dark: '#f08437', light: '#c64600' },
  { id: 'red', name: 'Red', dark: '#f2555a', light: '#c01c28' },
  { id: 'pink', name: 'Pink', dark: '#e56ba8', light: '#c4287f' },
  { id: 'slate', name: 'Slate', dark: '#8aa0b8', light: '#5b6b7f' },
]

export const DEFAULT_ACCENT = VIOLET.id

function accentById(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? VIOLET
}

/** One accent as the shade this scheme needs. What a caret belonging to another
 *  device is drawn in: which colour is theirs, which shade of it is the reader's.
 *  See rooms/peers.ts. */
export function accentColour(id: string, scheme: 'dark' | 'light'): string {
  return accentById(id)[scheme]
}

/** `#rrggbb` to its three channels. */
function channels(hex: string): [number, number, number] {
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
function shift(hex: string, towards: 'light' | 'dark', amount = 0.14): string {
  const target = towards === 'light' ? 255 : 0
  return toHex(
    channels(hex).map((one) => one + (target - one) * amount) as [number, number, number],
  )
}

/** Every token that depends on the accent, so one choice restyles the app.
 *
 *  With more contrast asked for, the colour moves further from the page rather
 *  than being replaced: it is still the colour they picked, at a strength they
 *  can read it at. Everything drawn from it is stronger with it - a selection has
 *  to be seen through, but it has to be seen. */
export function accentTokens(
  id: string,
  scheme: 'dark' | 'light',
  contrast = false,
): Record<string, string> {
  const away = scheme === 'dark' ? 'light' : 'dark'
  const base = contrast ? shift(accentById(id)[scheme], away, 0.32) : accentById(id)[scheme]
  const [r, g, b] = channels(base)
  const soft = scheme === 'dark' ? 0.15 : 0.1
  const line = scheme === 'dark' ? 0.42 : 0.38
  const chosen = scheme === 'dark' ? 0.28 : 0.18

  return {
    '--accent': base,
    // Hover moves away from the background, whichever way that is.
    '--accent-hover': shift(base, away),
    '--accent-soft': `rgb(${r} ${g} ${b} / ${contrast ? soft + 0.1 : soft})`,
    '--accent-line': `rgb(${r} ${g} ${b} / ${contrast ? 0.75 : line})`,
    '--selection': `rgb(${r} ${g} ${b} / ${contrast ? chosen + 0.14 : chosen})`,
  }
}
