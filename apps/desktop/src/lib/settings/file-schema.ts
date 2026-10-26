/** What the settings file may say (#673), made from the fields that declare it.
 *
 *  Every field with a `key` is one setting the file may set (see declarations.ts), of
 *  the type its kind reads and writes, held to the choices or the range the row offers;
 *  switches that are members of one key make a list. The schema is written beside the
 *  flake as packaging/nix/settings-schema.json, made on every desktop platform and
 *  merged, each setting that is not on all of them saying which it is on; Home
 *  Manager's `programs.orden.settings` options are made from it. file-schema.test.ts
 *  fails when the file has drifted from the fields, and `vitest -u` writes it again.
 *  The same rules check a file at launch, in file.ts, so what Nix lets through
 *  is what the app takes. */

import type { Field } from './fields'

/** The desktops a settings file is read on; see `platform` in ../tauri.ts. */
const PLATFORMS = ['linux', 'macos', 'windows'] as const
export type Platform = (typeof PLATFORMS)[number]

type Value = boolean | number | string

/** One setting the file may set. */
export interface SettingSchema {
  type: 'boolean' | 'number' | 'string' | 'list'
  /** The values it may be, or a list's members may be, where the row offers a fixed set. */
  enum?: string[]
  min?: number
  max?: number
  /** What the app starts as, where the row says and it is the same everywhere. */
  default?: Value | string[]
  /** The sentence behind the row's `?`, in English. */
  description: string
  /** The platforms it is a setting on, where it is not on all of them. */
  platforms?: Platform[]
}

/** Every setting the file may set, by key, in the order of their keys. */
export type Schema = Record<string, SettingSchema>

/** What one field may be set to from a file, or nothing for a field no file sets. A
 *  list's member says only its own value; `schemaOf` gathers them. */
function settingOf(field: Field): SettingSchema | null {
  if (!field.key) return null
  const about = { description: field.hint }
  const initial =
    'initial' in field && field.initial !== undefined ? { default: field.initial } : {}
  if (field.member !== undefined) {
    if (field.kind !== 'switch') return null
    return {
      type: 'list',
      enum: [field.member],
      ...(field.initial === true ? { default: [field.member] } : {}),
      ...about,
    }
  }
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
        // An open list - what this machine has - and colours of the reader's own after
        // the swatches take any value.
        ...((field.kind === 'select' && field.open) || (field.kind === 'swatches' && field.pair)
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

/** A list's members as one list: their choices joined, and on by default the ones
 *  that are. */
function gathered(one: SettingSchema, other: SettingSchema, key: string): SettingSchema {
  if (one.type !== 'list' || other.type !== 'list')
    throw new Error(`settings key ${key} is used twice`)
  const defaults = [
    ...((one.default as string[] | undefined) ?? []),
    ...((other.default as string[] | undefined) ?? []),
  ]
  return {
    ...one,
    enum: [...new Set([...(one.enum ?? []), ...(other.enum ?? [])])],
    ...(defaults.length ? { default: defaults } : {}),
  }
}

/** One setting as two platforms declare it: the choices of both, the wider range, and
 *  a default only where they agree. */
function across(one: SettingSchema, other: SettingSchema, key: string): SettingSchema {
  if (one.type !== other.type) throw new Error(`settings key ${key} is two types`)
  const both: SettingSchema = { ...one }
  if (one.enum && other.enum) both.enum = [...new Set([...one.enum, ...other.enum])]
  else delete both.enum
  if (JSON.stringify(one.default) !== JSON.stringify(other.default)) delete both.default
  if (one.min !== undefined && other.min !== undefined) both.min = Math.min(one.min, other.min)
  if (one.max !== undefined && other.max !== undefined) both.max = Math.max(one.max, other.max)
  return both
}

/** The schema of the fields. A key used twice for anything but a list's members is a
 *  mistake in a declaration, and said rather than letting the second win. */
export function schemaOf(fields: Field[]): Schema {
  const found = new Map<string, SettingSchema>()
  for (const field of fields) {
    const setting = settingOf(field)
    if (!setting || !field.key) continue
    const there = found.get(field.key)
    found.set(field.key, there ? gathered(there, setting, field.key) : setting)
  }
  return sorted(found)
}

/** One schema out of each platform's, each setting saying where it is one where that is
 *  not everywhere; where the platforms differ, the choices of all of them. */
export function mergedSchema(each: Record<Platform, Schema>): Schema {
  const found = new Map<string, SettingSchema>()
  const where = new Map<string, Platform[]>()
  for (const platform of PLATFORMS) {
    for (const [key, setting] of Object.entries(each[platform])) {
      const there = found.get(key)
      found.set(key, there ? across(there, setting, key) : setting)
      where.set(key, [...(where.get(key) ?? []), platform])
    }
  }
  for (const [key, platforms] of where) {
    if (platforms.length === PLATFORMS.length) continue
    const setting = found.get(key)
    if (setting) found.set(key, { ...setting, platforms })
  }
  return sorted(found)
}

function sorted(found: Map<string, SettingSchema>): Schema {
  return Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Why `value` is not one `setting` takes, or null where it is. */
export function refusal(setting: SettingSchema, value: unknown): string | null {
  if (setting.type === 'list') {
    if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
      return 'should be a list of strings'
    }
    const strange = (value as string[]).filter((one) => setting.enum && !setting.enum.includes(one))
    if (strange.length) {
      return `has ${strange.map((one) => JSON.stringify(one)).join(', ')}, which should be among ${listed(setting.enum ?? [])}`
    }
    return null
  }
  if (typeof value !== setting.type) return `should be a ${setting.type}`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'should be a number'
    if (setting.min !== undefined && value < setting.min) return `should be at least ${setting.min}`
    if (setting.max !== undefined && value > setting.max) return `should be at most ${setting.max}`
  }
  if (setting.enum && typeof value === 'string' && !setting.enum.includes(value)) {
    return `should be one of ${listed(setting.enum)}`
  }
  return null
}

function listed(values: string[]): string {
  return values.map((one) => JSON.stringify(one)).join(', ')
}
