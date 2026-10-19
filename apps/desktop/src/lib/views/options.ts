/** A property's choices (`nib.properties.<key>.options`), Notion's select and status:
 *  each a value, a tone and, for a status, which of To do, Doing and Done it belongs
 *  to. And the two writes a choice brings about in the notes: a value renamed in every
 *  note that holds it, and a base's ids written again under a new prefix. Pure but for
 *  the rows handed in. */

import {
  type Base,
  type Context,
  idNumber,
  idText,
  inBase,
  type Row,
  type SelectOption,
  type Value,
} from '@nib/bases'
import type { RowChange } from '../rows/write'
import { bare } from './columns'

/** The words a value holds, a list member by member. */
function wordsIn(value: Value | undefined): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(wordsIn)
  return []
}

/** The values a property holds across these rows, in the order they first appear: the
 *  choices a text column turned into a select starts with. */
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

/** The six tones in the order a new choice takes them. */
const TONES = ['1', '2', '3', '4', '5', '6']

/** Choices for these values, each in the next tone. */
export function optionsFor(values: readonly string[]): SelectOption[] {
  return values.map((value, at) => ({ value, tone: TONES[at % TONES.length] ?? '1' }))
}

/** The options a base gives a property. */
export function optionsAt(base: Base, property: string): SelectOption[] {
  return base.nib.properties[bare(property)]?.options ?? []
}

/** The change that renames one value in a row, a list's member where it is a list;
 *  null where the row does not hold it. */
export function renamedIn(row: Row, property: string, from: string, to: string): RowChange | null {
  const key = bare(property)
  const value = row.note[key]
  if (Array.isArray(value)) {
    if (!value.some((one) => wordsIn(one).includes(from))) return null
    // Renamed into a member it already holds, as a merge does: that one, once.
    const next = value.map((one) => (wordsIn(one).includes(from) ? to : one))
    return { note: { [key]: next.filter((one, at) => one !== to || next.indexOf(to) === at) } }
  }
  return wordsIn(value).includes(from) ? { note: { [key]: to } } : null
}

/** The changes that rename a choice in the notes of one base, and no other: another
 *  base of the same space may hold a choice of the same words. */
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

/** The changes that write a base's ids again under a new prefix. */
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

/** The change that takes one value out of a row: a list's member, or the value itself,
 *  which takes the key away; null where the row does not hold it. */
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

/** The changes that take a choice out of the notes of one base, and no other. */
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

/** Whether a property holds lists in any of these rows: a new card of its column then
 *  holds a list of the column's one value. */
export function holdsLists(rows: readonly Row[], property: string): boolean {
  const key = bare(property)
  return rows.some((row) => Array.isArray(row.note[key]))
}
