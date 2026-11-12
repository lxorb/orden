import type { ThemeId } from './ids'

export type Scheme = 'dark' | 'light'

export type SchemeChoice = Scheme | 'system'

export type ThemeValue = string | number | boolean

export type ChosenSettings = Readonly<Record<string, Readonly<Record<string, ThemeValue>>>>

export interface ThemeInfo {
  readonly id: ThemeId
  readonly name: string
  readonly variants: readonly Scheme[]
  readonly path?: string
  readonly translucent?: boolean
  readonly pictured?: boolean
}

export const SCHEMES: readonly Scheme[] = ['dark', 'light']

export function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

export function isSchemeChoice(value: unknown): value is SchemeChoice {
  return value === 'system' || isScheme(value)
}
