import type { Field } from './fields'

const PLATFORMS = ['linux', 'macos', 'windows'] as const
export type Platform = (typeof PLATFORMS)[number]

type Value = boolean | number | string

export interface SettingSchema {
  type: 'boolean' | 'number' | 'string' | 'list'
  enum?: string[]
  min?: number
  max?: number
  default?: Value | string[]
  description: string
  platforms?: Platform[]
}

export type Schema = Record<string, SettingSchema>

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

export function mergedSchema(each: Record<Platform, Schema>): Schema {
  const found = new Map<string, SettingSchema>()
  const where = new Map<string, Platform[]>()
  for (const platform of PLATFORMS) {
    for (const [key, setting] of Object.entries(each[platform])) {
      const there = found.get(key)
      found.set(key, there ? across(there, setting, key) : setting)
      const platforms = where.get(key)
      if (platforms) platforms.push(platform)
      else where.set(key, [platform])
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
