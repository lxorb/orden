import {
  type Base,
  type Context,
  idNumber,
  idText,
  inBase,
  type Row,
  type SelectOption,
  type Value,
} from '@orden/bases'
import type { RowChange } from '../../rows/write'
import { bare } from './columns'

function wordsIn(value: Value | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(wordsIn)
  return []
}

export function valuesOf(rows: readonly Row[], property: string, most = 50): string[] {
  const key = bare(property)
  const seen: string[] = []
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const one of wordsIn(row.note[key])) {
      if (!seen.includes(one)) seen.push(one)
      if (seen.length >= most) return seen
    }
  }
  return seen
}

const TONES = ['1', '2', '3', '4', '5', '6']

export function optionsFor(values: readonly string[]): SelectOption[] {
  return values.map((value, at) => ({ value, tone: TONES[at % TONES.length] ?? '1' }))
}

export function optionsAt(base: Base, property: string): SelectOption[] {
  return base.orden.properties[bare(property)]?.options ?? []
}

export function renamedIn(row: Row, property: string, from: string, to: string): RowChange | null {
  const key = bare(property)
  const value = row.note[key]
  if (Array.isArray(value)) {
    if (!value.some((one) => wordsIn(one).includes(from))) return null
    const next = value.map((one) => (wordsIn(one).includes(from) ? to : one))
    return { note: { [key]: next.filter((one, at) => one !== to || next.indexOf(to) === at) } }
  }
  return wordsIn(value).includes(from) ? { note: { [key]: to } } : null
}

export function renamedInBase(
  base: Base,
  rows: readonly Row[],
  context: Context,
  property: string,
  from: string,
  to: string,
): { row: Row; change: RowChange }[] {
  return rows.flatMap((row) => {
    if (!inBase(base, row, context)) return []
    const change = renamedIn(row, property, from, to)
    return change ? [{ row, change }] : []
  })
}

export function reprefixed(
  rows: readonly Row[],
  property: string,
  from: string,
  to: string,
): { row: Row; change: RowChange }[] {
  return rows.flatMap((row) => {
    const number = idNumber(row.note[property], from)
    return number === null ? [] : [{ row, change: { note: { [property]: idText(to, number) } } }]
  })
}

function clearedIn(row: Row, property: string, value: string): RowChange | null {
  const key = bare(property)
  const now = row.note[key]
  if (Array.isArray(now)) {
    if (!now.some((one) => wordsIn(one).includes(value))) return null
    const kept = now.filter((one) => !wordsIn(one).includes(value))
    return { note: { [key]: kept.length ? kept : null } }
  }
  return wordsIn(now).includes(value) ? { note: { [key]: null } } : null
}

export function clearedInBase(
  base: Base,
  rows: readonly Row[],
  context: Context,
  property: string,
  value: string,
): { row: Row; change: RowChange }[] {
  return rows.flatMap((row) => {
    if (row.kind !== 'note' || !inBase(base, row, context)) return []
    const change = clearedIn(row, property, value)
    return change ? [{ row, change }] : []
  })
}

export function holdsLists(rows: readonly Row[], property: string): boolean {
  const key = bare(property)
  return rows.some((row) => Array.isArray(row.note[key]))
}
