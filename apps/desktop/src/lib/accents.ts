import type { ThemeSetting } from './theme/src/api'

export interface Accent {
  id: string
  name: string
  dark: string
  light: string
}

const VIOLET: Accent = { id: 'violet', name: 'Violet', dark: '#7c6bf5', light: '#5b4be0' }

export const ACCENTS: Accent[] = [
  VIOLET,
  { id: 'blue', name: 'Blue', dark: '#3584e4', light: '#1b6ed3' },
  { id: 'teal', name: 'Teal', dark: '#33c7ba', light: '#0d7d73' },
  { id: 'green', name: 'Green', dark: '#3fcf8e', light: '#177f52' },
  { id: 'yellow', name: 'Yellow', dark: '#e5b23c', light: '#986507' },
  { id: 'orange', name: 'Orange', dark: '#f08437', light: '#c44500' },
  { id: 'red', name: 'Red', dark: '#f2555a', light: '#c01c28' },
  { id: 'pink', name: 'Pink', dark: '#e56ba8', light: '#c4287f' },
  { id: 'slate', name: 'Slate', dark: '#8aa0b8', light: '#5b6b7f' },
]

export const DEFAULT_ACCENT = VIOLET.id

function accentById(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? VIOLET
}

export function accentColour(id: string, scheme: 'dark' | 'light'): string {
  return accentById(id)[scheme]
}

export function accentIdFor(name: string): string {
  let sum = 0
  for (const character of name.trim().toLowerCase()) {
    sum = (sum + (character.codePointAt(0) ?? 0)) % 4093
  }

  return ACCENTS[sum % ACCENTS.length]?.id ?? DEFAULT_ACCENT
}

export function accentFor(name: string, scheme: 'dark' | 'light'): string {
  return accentColour(accentIdFor(name), scheme)
}

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

function shift(hex: string, towards: 'light' | 'dark', amount = 0.14): string {
  const target = towards === 'light' ? 255 : 0
  return toHex(
    channels(hex).map((one) => one + (target - one) * amount) as [number, number, number],
  )
}

export function accentTokens(id: string, scheme: 'dark' | 'light'): Record<string, string> {
  const away = scheme === 'dark' ? 'light' : 'dark'
  const base = accentById(id)[scheme]
  const [r, g, b] = channels(base)
  const soft = scheme === 'dark' ? 0.15 : 0.1
  const line = scheme === 'dark' ? 0.42 : 0.38
  const chosen = scheme === 'dark' ? 0.28 : 0.18

  return {
    '--accent': base,
    '--accent-hover': shift(base, away),
    '--accent-press': shift(base, away, 0.26),
    '--accent-soft': `rgb(${r} ${g} ${b} / ${soft})`,
    '--accent-line': `rgb(${r} ${g} ${b} / ${line})`,
    '--selection': `rgb(${r} ${g} ${b} / ${chosen})`,
  }
}

export function accentSetting(): ThemeSetting {
  return {
    id: 'accent',
    label: 'Accent',
    hint: 'The colour of buttons, links and the selection.',
    shared: true,
    kind: 'colour',
    initial: DEFAULT_ACCENT,
    options: ACCENTS.map((one) => ({
      value: one.id,
      name: one.name,
      dark: one.dark,
      light: one.light,
    })),
    paint: (value, scheme) => accentTokens(String(value), scheme),
  }
}
