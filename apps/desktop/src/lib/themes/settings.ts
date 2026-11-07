import type { Scheme } from '../theme.svelte'
import type { OwnPair } from './own-pair'

export type ThemeValue = string | number | boolean

interface Swatch {
  value: string
  name: string
  dark: string
  light: string
}

interface Common {
  id: string
  label: string
  hint: string
  shared?: boolean
  own?: boolean
  when?: () => boolean
  reapplies?: boolean
  paint(value: ThemeValue, scheme: Scheme): Record<string, string>
}

export type ThemeSetting = Common &
  (
    | {
        kind: 'colour'
        options: Swatch[]
        initial: string
        pair?: OwnPair
      }
    | {
        kind: 'choice'
        options: { value: string; label: string; disabled?: boolean }[]
        initial: string
      }
    | {
        kind: 'range'
        min: number
        max: number
        step: number
        unit: string
        initial: number
        least?: () => number
      }
    | { kind: 'switch'; initial: boolean }
  )

export const SETTINGS_KEY = 'orden:theme-settings'

export type ChosenSettings = Record<string, Record<string, ThemeValue>>

export const SHARED = '*'

export const DECLARES = '--nib-setting-'
export const WRITES = '--nib-'

export function declares(css: string): boolean {
  return css.includes(DECLARES)
}

export function valueOf(setting: ThemeSetting, held: unknown): ThemeValue {
  if (setting.kind === 'switch') return typeof held === 'boolean' ? held : setting.initial

  if (setting.kind === 'range') {
    if (typeof held !== 'number' || !Number.isFinite(held)) return setting.initial
    return Math.min(setting.max, Math.max(setting.min, held))
  }

  if (typeof held !== 'string') return setting.initial
  if (setting.kind === 'colour' && setting.pair?.accepts(held)) return held
  return setting.options.some((one) => one.value === held) ? held : setting.initial
}

export function paintOf(
  settings: ThemeSetting[],
  values: Record<string, ThemeValue>,
  scheme: Scheme,
): Record<string, string> {
  const painted: Record<string, string> = {}

  for (const setting of settings) {
    Object.assign(painted, setting.paint(valueOf(setting, values[setting.id]), scheme))
  }

  return painted
}

export function paintsOver(css: string, setting: ThemeSetting): boolean {
  const tokens = Object.keys(setting.paint(setting.initial, 'dark'))
  return tokens.some((token) => new RegExp(`${token}\\s*:(?!\\s*inherit\\b)`).test(css))
}
