/** A list view's answer as the rows it draws, one row tall each: a group's head, its
 *  tasks with their sub-tasks under them, and the add row at the end of a group.
 *
 *  A sub-task sits under its parent wherever both are in the group, indented a level,
 *  and a parent wears a twist that folds them (docs/tasks.md 3, row 97). A note sits
 *  under the note its `parent` property links to, Notion's sub-items, the same way
 *  (docs/tasks.md 4, "sub-items"). One flat list
 *  of same-height rows is what the window arithmetic needs (row-window.ts), so a
 *  Completed view of ten thousand done lines mounts the thirty on screen. Pure. */

import { addDays, type Group, groupName, type Row, rowId } from '@nib/bases'
import { dayIn } from './values'
import { isTitle } from './sections'

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
  /** Whether the view groups at all: an ungrouped view draws no heads. */
  grouped: boolean
  /** Whether the group of rows with no value goes without a head: a project's tasks
   *  above its first heading are Todoist's tasks in no section, which have none. */
  bareNone?: boolean
  /** The note a project is, whose title heading holds no section: its group goes
   *  without a head too. */
  title?: string
  /** Groups folded, by name. */
  folded: ReadonlySet<string>
  /** Parents whose sub-tasks are folded, by row id. */
  shut: ReadonlySet<string>
  /** Groups the view keeps out of sight, by name. */
  hidden?: readonly string[]
  /** Whether each group ends in an add row. */
  adding: boolean
  /** The row id of the note a note row sits under, where it names one. */
  parentOf?: (row: Row) => string | null
}

/** A group's rows in tree order, each with its depth. */
function tree(
  rows: readonly Row[],
  shut: ReadonlySet<string>,
  parentOf?: (row: Row) => string | null,
): { row: Row; depth: number; parent: boolean }[] {
  const present = new Set(rows.map(rowId))
  const children = new Map<string, Row[]>()
  const roots: Row[] = []
  for (const row of rows) {
    const parent = row.task?.parent
    const parentId = row.task
      ? parent === undefined
        ? null
        : `${row.path}#${parent}`
      : (parentOf?.(row) ?? null)
    if (parentId !== null && present.has(parentId)) {
      children.set(parentId, [...(children.get(parentId) ?? []), row])
    } else roots.push(row)
  }

  // Notes that name each other as parents have no root among them; the first of each
  // such ring is shown at the top rather than lost.
  const reached = new Set<string>()
  const reach = (row: Row) => {
    const id = rowId(row)
    if (reached.has(id)) return
    reached.add(id)
    for (const child of children.get(id) ?? []) reach(child)
  }
  for (const root of roots) reach(root)
  for (const row of rows) {
    if (reached.has(rowId(row))) continue
    roots.push(row)
    reach(row)
  }

  const out: { row: Row; depth: number; parent: boolean }[] = []
  const placed = new Set<string>()
  const walk = (row: Row, depth: number) => {
    const id = rowId(row)
    placed.add(id)
    const under = (children.get(id) ?? []).filter((child) => !placed.has(rowId(child)))
    out.push({ row, depth, parent: under.length > 0 })
    if (shut.has(id)) return
    for (const child of under) if (!placed.has(rowId(child))) walk(child, depth + 1)
  }
  for (const root of roots) if (!placed.has(rowId(root))) walk(root, 0)
  return out
}

/** The items a list draws for an answer's groups. */
export function listItems(groups: readonly Group[], options: ListOptions): Item[] {
  const out: Item[] = []
  for (const group of groups) {
    const name = groupName(group.key)
    if (options.hidden?.includes(name)) continue
    const folded = options.folded.has(name)
    const bare =
      options.bareNone === true &&
      (group.key === null ||
        group.key === '' ||
        (options.title !== undefined &&
          typeof group.key === 'string' &&
          isTitle(group.key, options.title)))
    if (options.grouped && !bare) {
      out.push({ kind: 'head', id: `head:${name}`, group, count: group.rows.length, folded })
      if (folded) continue
    }
    for (const one of tree(group.rows, options.shut, options.parentOf)) {
      const id = rowId(one.row)
      out.push({
        kind: 'row',
        id: `row:${one.row.space}:${id}`,
        row: one.row,
        group,
        depth: one.depth,
        twist: one.parent ? (options.shut.has(id) ? 'shut' : 'open') : null,
      })
    }
    if (options.adding)
      out.push({ kind: 'add', id: `add:${name}`, group: options.grouped ? group : null })
  }
  return out
}

/** A set with a key put in, or taken out where it was there: a fold toggled. */
export function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** The rows selected once one more is pressed: it alone toggled, or with `from` (the
 *  last one pressed, in `order`) every row between the two put in. */
export function withPicked(
  picked: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  from: string | null,
): ReadonlySet<string> {
  const at = order.indexOf(id)
  const start = from === null ? -1 : order.indexOf(from)
  if (start === -1 || at === -1) return toggled(picked, id)
  return new Set([...picked, ...order.slice(Math.min(start, at), Math.max(start, at) + 1)])
}

/** A board's swimlanes: every key the columns' sub-groups have, in the order they first
 *  come. */
export function laneKeys(groups: readonly Group[]): Group['key'][] {
  const seen = new Map<string, Group['key']>()
  for (const group of groups)
    for (const one of group.sub ?? []) seen.set(groupName(one.key), one.key)
  return [...seen.values()]
}

/** No keys: nothing folded yet. */
export const EMPTY: ReadonlySet<string> = new Set()

/** Upcoming's days, every one from `from` through `through` whether it holds a task or
 *  not, so a day can be planned into before anything is in it (Todoist's way): the
 *  groups that are not days first (what is overdue), then the days, a day nothing is
 *  due on an empty group of its own, then any later day that holds tasks. */
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

/** A project's groups with every section of its note, the empty ones too, in the order
 *  the note has them: Todoist draws a section with nothing in it yet, ready to be added
 *  to. The tasks in no section, and the title's, come first; a group the note has no
 *  heading for any more stays at the end. */
export function withEverySection(
  groups: readonly Group[],
  headings: readonly string[],
  title: string,
): Group[] {
  const named = new Map<string, Group>()
  const out: Group[] = []
  for (const group of groups) {
    const key = group.key
    if (typeof key === 'string' && key && !isTitle(key, title)) named.set(key, group)
    else out.push(group)
  }
  for (const heading of new Set(headings)) {
    if (isTitle(heading, title)) continue
    out.push(named.get(heading) ?? { key: heading, rows: [], summaries: {} })
    named.delete(heading)
  }
  return [...out, ...named.values()]
}

/** Every-day groups cut to the days from one through another: a board of two weeks has
 *  no column outside them. A group that is no day, what is overdue, stays. */
export function withinDays(groups: readonly Group[], from: string, through: string): Group[] {
  return groups.filter((group) => {
    const day = dayIn(group.key)
    return day === null || (day >= from && day <= through)
  })
}
