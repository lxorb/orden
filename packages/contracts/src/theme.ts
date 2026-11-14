import type { ThemeId } from './ids'

export type Scheme = 'dark' | 'light'

export type SchemeChoice = Scheme | 'system'

export type ThemeValue = string | number | boolean

export type ChosenSettings = Readonly<Record<string, Readonly<Record<string, ThemeValue>>>>

export interface ThemeSwatch {
  value: string
  name: string
  dark: string
  light: string
}

export interface OwnPair {
  accepts(held: string): boolean
  colours(held: string, scheme: Scheme): readonly [string, string]
  of(first: string, second: string): string
}

interface ThemeSettingCommon {
  id: string
  label: string
  hint: string
  shared?: boolean
  own?: boolean
  when?: () => boolean
  reapplies?: boolean
  paint(value: ThemeValue, scheme: Scheme): Record<string, string>
}

export type ThemeSetting = ThemeSettingCommon &
  (
    | {
        kind: 'colour'
        options: ThemeSwatch[]
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

export interface ThemeInfo {
  readonly id: ThemeId
  readonly name: string
  readonly variants: readonly Scheme[]
  readonly path?: string
  readonly translucent?: boolean
  readonly pictured?: boolean
  readonly load?: () => Promise<string>
  readonly own?: () => Promise<() => ThemeSetting[]>
}

export interface ThemeLooksPort {
  glassSettings(): Promise<() => ThemeSetting[]>
  wallpaperSheet(): Promise<string>
  wallpaperSettings(): Promise<() => ThemeSetting[]>
  wakeWallpaper(): Promise<void>
  follow(): Promise<void>
  landed(tab: string): Promise<void>
}

export interface ThemePorts {
  readonly 'theme.looks': ThemeLooksPort
}

export const SCHEMES: readonly Scheme[] = ['dark', 'light']

export function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

export function isSchemeChoice(value: unknown): value is SchemeChoice {
  return value === 'system' || isScheme(value)
}
