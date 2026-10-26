/** What the settings file may say (#673), made from the panes' own declarations.
 *
 *  Every field with a `key` is one setting the file may set, of the type its kind
 *  reads and writes, held to the choices or the range the row offers. The schema is
 *  written beside the flake as packaging/nix/settings-schema.json, which is what Home
 *  Manager's `programs.orden.settings` options are made from; settings-schema.test.ts
 *  fails when the two have drifted apart, and `vitest -u` writes it again. The same
 *  rules check a file at launch, in file.svelte.ts, so what Nix lets through is what
 *  the app takes. */

import type { Field, Pane } from './fields'

/** One setting the file may set. */
export interface SettingSchema {
  type: 'boolean' | 'number' | 'string'
  /** The values it may be, where the row offers a fixed set. */
  enum?: string[]
  min?: number
  max?: number
  /** What the app starts as, where the row says. */
  default?: boolean | number | string
  /** The sentence behind the row's `?`, in English. */
  description: string
}

/** Every setting the file may set, by key, in the order of their keys. */
export type Schema = Record<string, SettingSchema>

/** What one field may be set to from a file, or nothing for a field no file sets. */
export function settingOf(field: Field): SettingSchema | null {
  if (!field.key) return null
  const about = { description: field.hint }
  const initial =
    'initial' in field && field.initial !== undefined ? { default: field.initial } : {}
  switch (field.kind) {
    case 'switch':
      return { type: 'boolean', ...initial, ...about }
    case 'slider':
      return { type: 'number', min: field.min, max: field.max, ...initial, ...about }
    case 'select':
    case 'segmented':
    case 'swatches':
      return {
        type: 'string',
        ...(field.kind === 'select' && field.open
          ? {}
          : { enum: field.options.map((one) => one.value) }),
        ...initial,
        ...about,
      }
    case 'text':
      return { type: 'string', ...initial, ...about }
    case 'picture':
    case 'value':
      return null
  }
}

/** The schema of every keyed field in the panes. A key used twice is a mistake in a
 *  declaration, and said rather than letting the second win. */
export function schemaOf(panes: Pane[]): Schema {
  const found = new Map<string, SettingSchema>()
  for (const pane of panes)
    for (const group of pane.groups)
      for (const field of group.fields) {
        const setting = settingOf(field)
        if (!setting || !field.key) continue
        if (found.has(field.key)) throw new Error(`settings key ${field.key} is used twice`)
        found.set(field.key, setting)
      }
  return Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Why `value` is not one `setting` takes, or null where it is. */
export function refusal(setting: SettingSchema, value: unknown): string | null {
  if (typeof value !== setting.type) return `should be a ${setting.type}`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'should be a number'
    if (setting.min !== undefined && value < setting.min) return `should be at least ${setting.min}`
    if (setting.max !== undefined && value > setting.max) return `should be at most ${setting.max}`
  }
  if (setting.enum && typeof value === 'string' && !setting.enum.includes(value)) {
    return `should be one of ${setting.enum.map((one) => JSON.stringify(one)).join(', ')}`
  }
  return null
}
