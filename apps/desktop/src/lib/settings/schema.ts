import type { Field } from './fields'

type Value = boolean | number | string

export interface SettingSchema {
  type: 'boolean' | 'number' | 'string' | 'list'
  enum?: string[]
  min?: number
  max?: number
  default?: Value | string[]
  description: string
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
