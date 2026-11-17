import { addDays, type Group, groupName, type Row, rowId } from '@orden/bases'
import { dayIn } from './values'

export type Item =
  | { kind: 'head'; id: string; group: Group; count: number; folded: boolean }
  | {
      kind: 'row'
      id: string
      row: Row
      group: Group
      depth: number
      twist: 'open' | 'shut' | null
    }
  | { kind: 'add'; id: string; group: Group | null }

export interface ListOptions {
  grouped: boolean
  bareNone?: boolean
  folded: ReadonlySet<string>
  shut: ReadonlySet<string>
  hidden?: readonly string[]
  adding: boolean
  parentOf?: (row: Row) => string | null
}

export const foldKey = (row: Row): string => `${row.space}\n${rowId(row)}`

function tree(
  rows: readonly Row[],
  shut: ReadonlySet<string>,
  parentOf?: (row: Row) => string | null,
): { row: Row; depth: number; parent: boolean }[] {
  const keys = new Map<Row, string>()
  for (const row of rows) keys.set(row, foldKey(row))
  const keyOf = (row: Row) => keys.get(row) ?? foldKey(row)
  const present = new Set(keys.values())
  const children = new Map<string, Row[]>()
  const roots: Row[] = []
  for (const row of rows) {
    const parent = row.task?.parent
    const said = row.task
      ? parent === undefined
        ? null
        : `${row.path}#${parent}`
      : (parentOf?.(row) ?? null)
    const parentKey = said === null ? null : `${row.space}\n${said}`
    if (parentKey === null || !present.has(parentKey)) {
      roots.push(row)
      continue
    }
    const siblings = children.get(parentKey)
    if (siblings) siblings.push(row)
    else children.set(parentKey, [row])
  }

  const reached = new Set<string>()
  const reach = (row: Row) => {
    const key = keyOf(row)
    if (reached.has(key)) return
    reached.add(key)
    for (const child of children.get(key) ?? []) reach(child)
  }
  for (const root of roots) reach(root)
  for (const row of rows) {
    if (reached.has(keyOf(row))) continue
    roots.push(row)
    reach(row)
  }

  const out: { row: Row; depth: number; parent: boolean }[] = []
  const placed = new Set<string>()
  const walk = (row: Row, depth: number) => {
    const key = keyOf(row)
    placed.add(key)
    const under = (children.get(key) ?? []).filter((child) => !placed.has(keyOf(child)))
    out.push({ row, depth, parent: under.length > 0 })
    if (shut.has(key)) return
    for (const child of under) if (!placed.has(keyOf(child))) walk(child, depth + 1)
  }
  for (const root of roots) if (!placed.has(keyOf(root))) walk(root, 0)
  return out
}

export function distinctKeys(): (row: Row, group: string) => string {
  const given = new Set<string>()
  return (row, group) => {
    let key = `${row.space}:${rowId(row)}`
    while (given.has(key)) key += `\n${group}`
    given.add(key)
    return key
  }
}

export function everyRow(groups: readonly Group[]): Row[] {
  return [...new Set(groups.flatMap((group) => group.rows))]
}

export function listItems(groups: readonly Group[], options: ListOptions): Item[] {
  const out: Item[] = []
  const keyOfRow = distinctKeys()
  for (const group of groups) {
    const name = groupName(group.key)
    if (options.hidden?.includes(name)) continue
    const folded = options.folded.has(name)
    const bare = options.bareNone === true && (group.key === null || group.key === '')
    if (options.grouped && !bare) {
      out.push({ kind: 'head', id: `head:${name}`, group, count: group.rows.length, folded })
      if (folded) continue
    }
    for (const one of tree(group.rows, options.shut, options.parentOf)) {
      out.push({
        kind: 'row',
        id: `row:${keyOfRow(one.row, name)}`,
        row: one.row,
        group,
        depth: one.depth,
        twist: one.parent ? (options.shut.has(foldKey(one.row)) ? 'shut' : 'open') : null,
      })
    }
    if (options.adding)
      out.push({ kind: 'add', id: `add:${name}`, group: options.grouped ? group : null })
  }
  return out
}

export function laneKeys(groups: readonly Group[]): Group['key'][] {
  const seen = new Map<string, Group['key']>()
  for (const group of groups)
    for (const one of group.sub ?? []) seen.set(groupName(one.key), one.key)
  return [...seen.values()]
}

export function withEveryDay(groups: readonly Group[], from: string, through: string): Group[] {
  const days = new Map<string, Group>()
  const out: Group[] = []
  for (const group of groups) {
    const day = dayIn(group.key)
    if (day !== null && day >= from) days.set(day, group)
    else out.push(group)
  }
  for (let day = from; day <= through; day = addDays(day, 1)) {
    out.push(days.get(day) ?? { key: { kind: 'date', iso: day }, rows: [], summaries: {} })
  }
  for (const [day, group] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (day > through) out.push(group)
  }
  return out
}

export function withinDays(groups: readonly Group[], from: string, through: string): Group[] {
  return groups.filter((group) => {
    const day = dayIn(group.key)
    return day === null || (day >= from && day <= through)
  })
}
