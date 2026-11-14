import type { Scheme, ThemeSetting, ThemeValue } from '@orden/contracts'

export type { ThemeSetting, ThemeValue }

export const SETTINGS_KEY = 'orden:theme-settings'

export type ChosenSettings = Record<string, Record<string, ThemeValue>>

export const SHARED = '*'

export const DECLARES = '--orden-setting-'
export const WRITES = '--orden-'

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
