import type { SchemeChoice } from './theme.svelte'

export const SCHEME_CHOICES: SchemeChoice[] = ['system', 'dark', 'light']

export const SCHEME_NAMES: Record<SchemeChoice, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
}
