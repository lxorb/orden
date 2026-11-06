import type { Row, Value } from './types'

export function idText(prefix: string, number: number): string {
  return prefix ? `${prefix}-${number}` : String(number)
}

export function idNumber(value: Value | undefined, prefix: string): number | null {
  if (typeof value === 'number') return !prefix && Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const pattern = prefix
    ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
    : /^(\d+)$/
  const found = pattern.exec(value.trim())
  return found?.[1] ? Number(found[1]) : null
}

export function nextId(rows: readonly Row[], property: string, prefix: string): string {
  let highest = 0
  for (const row of rows) {
    if (row.kind !== 'note') continue
    const number = idNumber(row.note[property], prefix)
    if (number !== null && number > highest) highest = number
  }
  return idText(prefix, highest + 1)
}

const FORBIDDEN = '<>:"\\|?*'

function spelledAlike(path: string): string[] {
  const names = path
    .normalize('NFC')
    .split('/')
    .map((name) =>
      Array.from(name, (char) => (char < ' ' || FORBIDDEN.includes(char) ? '_' : char))
        .join('')
        .replace(/[. ]+$/, (tail) => '_'.repeat(tail.length))
        .toLowerCase(),
    )
  const last = names.length - 1
  names[last] = (names[last] ?? '').replace(/\.md$/, '')
  return names
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function byPath(a: Row, b: Row): number {
  const one = spelledAlike(a.path)
  const other = spelledAlike(b.path)
  for (let at = 0; at < Math.min(one.length, other.length); at++) {
    const order = byCode(one[at] ?? '', other[at] ?? '')
    if (order) return order
  }
  return one.length - other.length || byCode(a.path, b.path)
}

const older = (a: Row, b: Row) => a.file.ctime - b.file.ctime || byPath(a, b)

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
