import { groupName, type Row, type Value } from '@orden/bases'
import type { RowChange } from '../../rows/write'
import { bare, isNoteProperty } from './columns'

export interface Drop {
  change: RowChange
}

export function dropInto(property: string, key: Value, row: Row, from?: Value): Drop | null {
  if (!isNoteProperty(property)) return null
  const name = bare(property)
  const now = row.note[name] ?? null
  const next = Array.isArray(now) ? swapped(now, key, from) : key
  if (JSON.stringify(now) === JSON.stringify(next)) return null
  return { change: { note: { [name]: next } } }
}

function swapped(now: readonly Value[], key: Value, from: Value | undefined): Value {
  if (Array.isArray(key)) return key
  if (from === undefined || Array.isArray(from)) return key === null ? null : [key]
  const named = (one: Value) => (one === null ? '' : groupName(one))
  if (named(from) === named(key)) return [...now]
  const kept = named(from) === '' ? [...now] : now.filter((one) => named(one) !== named(from))
  if (key === null || named(key) === '') return kept.length ? kept : null
  return kept.some((one) => named(one) === named(key)) ? kept : [...kept, key]
}
