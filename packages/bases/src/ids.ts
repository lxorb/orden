/** Unique ids for the rows of a base: `BUG-45`, Notion's ID property, kept in a front
 *  matter key the base names (`nib.id: { property: id, prefix: BUG }`).
 *
 *  The next id is one more than the highest the rows hold, so an id is never handed out
 *  twice while its row exists. Two devices offline can both make 45; whoever looks
 *  first after the second sync renumbers one of them (`idRepairs`). Which one is decided
 *  by the note's path, spelled the same way on every disk: a file's creation time is
 *  each disk's own and sync does not carry it (B552). Pure. */

import type { Row, Value } from './types'

/** How a number is written with its prefix. */
export function idText(prefix: string, number: number): string {
  return prefix ? `${prefix}-${number}` : String(number)
}

/** The number an id holds, where it is one of this prefix's. */
export function idNumber(value: Value | undefined, prefix: string): number | null {
  if (typeof value === 'number') return !prefix && Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const pattern = prefix
    ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
    : /^(\d+)$/
  const found = pattern.exec(value.trim())
  return found?.[1] ? Number(found[1]) : null
}

/** The next free id: one past the highest of these rows. */
export function nextId(rows: readonly Row[], property: string, prefix: string): string {
  let highest = 0
  for (const row of rows) {
    if (row.kind !== 'note') continue
    const number = idNumber(row.note[property], prefix)
    if (number !== null && number > highest) highest = number
  }
  return idText(prefix, highest + 1)
}

/** What Windows holds in no name, beside the control characters. */
const FORBIDDEN = '<>:"\\|?*'

/** A path as every device spells it: each disk writes a name it cannot hold its own
 *  way (a `:` as `_` on a Mac, `<>:"\|?*` and a trailing dot or space as `_` on
 *  Windows; sync2/places.ts `localName`), a Mac may hold it decomposed, and a disk may
 *  fold case. Without its `.md`, so a copy, `Crash copy` or `Crash 2`, comes after the
 *  note it was copied from (`Crash`). */
function spelledAlike(path: string): string {
  return path
    .replace(/\.md$/i, '')
    .normalize('NFC')
    .split('/')
    .map((name) =>
      Array.from(name, (char) => (char < ' ' || FORBIDDEN.includes(char) ? '_' : char))
        .join('')
        .replace(/[. ]+$/, (tail) => '_'.repeat(tail.length)),
    )
    .join('/')
    .toLowerCase()
}

/** By that spelling, compared by code unit rather than by this device's locale, so every
 *  device orders them alike; the path as this disk has it only breaks a tie. */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byPath = (a: Row, b: Row) =>
  byCode(spelledAlike(a.path), spelledAlike(b.path)) || byCode(a.path, b.path)
/** Older first on this disk, for rows only this device numbers. */
const older = (a: Row, b: Row) => a.file.ctime - b.file.ctime || byPath(a, b)

/** The ids to write so that every row has one and no two share one: of two rows
 *  sharing one the later by path gets the next, in path order, so every device writes
 *  the same; then a row without one gets the next, in the order the rows were made. `missing` false leaves rows without one alone, which is
 *  what looking does; turning ids on gives every row one. */
export function idRepairs(
  rows: readonly Row[],
  property: string,
  prefix: string,
  missing = true,
): { row: Row; id: string }[] {
  const notes = rows.filter((row) => row.kind === 'note').sort(byPath)
  let next = idNumber(nextId(notes, property, prefix), prefix) ?? 1
  const seen = new Set<number>()
  const twins: Row[] = []
  const without: Row[] = []
  for (const row of notes) {
    const number = idNumber(row.note[property], prefix)
    if (number === null) without.push(row)
    else if (seen.has(number)) twins.push(row)
    else seen.add(number)
  }
  const out = twins.map((row) => ({ row, id: idText(prefix, next++) }))
  if (missing) for (const row of without.sort(older)) out.push({ row, id: idText(prefix, next++) })
  return out
}
