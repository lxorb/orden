/** Todoist's Display menu over a view of tasks: how it is grouped, how it is sorted and
 *  which way, whether done tasks stay, and what it is narrowed to - a priority, a label,
 *  a day. Each answer is a new base, so the change is kept where the view keeps its
 *  changes (a built-in view in its tab, a base in its file), and Obsidian reads every key
 *  it knows: the grouping and the sorting are Bases' own, the narrowing nib's under the
 *  view's `nib:` key (`only`), which Obsidian leaves alone.
 *
 *  Pure. `displayed` is what the engine is asked with: the view's own filters and the
 *  narrowing together. */

import type { Base, Row, View } from '@nib/bases'

export type Grouping = 'default' | 'none' | 'note' | 'section' | 'date' | 'deadline' | 'priority'
export type Sorting = 'default' | 'manual' | 'name' | 'date' | 'deadline' | 'priority' | 'note'

export const GROUPINGS: readonly Grouping[] = [
  'default',
  'none',
  'note',
  'section',
  'date',
  'deadline',
  'priority',
]
export const SORTINGS: readonly Sorting[] = [
  'default',
  'manual',
  'name',
  'date',
  'deadline',
  'priority',
  'note',
]

/** The property each choice groups or sorts by. */
const BY: Partial<Record<Grouping | Sorting, string>> = {
  note: 'file.basename',
  section: 'task.section',
  date: 'task.date',
  deadline: 'task.deadline',
  priority: 'task.priority',
  name: 'task.text',
}

/** What each grouping groups by, where it differs from what its sorting sorts by: a
 *  note's group is its path, so two notes of one name in two folders stay apart. */
const GROUP_BY: Partial<Record<Grouping, string>> = { ...BY, note: 'file.path' }

/** What a view is narrowed to. */
export interface Only {
  priority?: 1 | 2 | 3 | 4
  label?: string
  date?: 'overdue' | 'today' | 'week' | 'none'
  /** A note, by its path in its space: Todoist's project filter on Completed. */
  project?: string
}

/** The notes a view's rows are in, by name, for the project it can be narrowed to. */
export function notesIn(rows: readonly Row[]): { path: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const row of rows) if (row.task) seen.set(row.path, row.file.basename)
  return [...seen]
    .map(([path, name]) => ({ path, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function withView(base: Base, at: number, change: (view: View) => View): Base {
  const view = base.views[at]
  if (!view) return base
  return { ...base, views: base.views.map((one, index) => (index === at ? change(view) : one)) }
}

/** How a view is grouped, `default` where it is grouped as the view it came from is. */
export function groupingOf(view: View, original: View | null): Grouping {
  if (original && same(view.groupBy, original.groupBy)) return 'default'
  const by = view.groupBy?.property
  if (by === undefined) return 'none'
  // A view grouped by note before notes were grouped by path.
  if (by === 'file.basename') return 'note'
  return GROUPINGS.find((one) => GROUP_BY[one] === by) ?? 'none'
}

/** The view grouped another way. A note's headings are grouped in the order they are
 *  written, every other grouping by its values. */
export function withGrouping(
  base: Base,
  at: number,
  grouping: Grouping,
  original: View | null,
): Base {
  return withView(base, at, (view) => {
    const nib = { ...view.nib }
    delete nib.groupOrder
    const next: View = { ...view, nib }
    delete next.groupBy
    if (grouping === 'default') {
      if (original?.groupBy) next.groupBy = original.groupBy
      if (original?.nib.groupOrder) nib.groupOrder = original.nib.groupOrder
      return next
    }
    const property = GROUP_BY[grouping]
    if (property === undefined) return next
    if (grouping === 'section') nib.groupOrder = 'rows'
    next.groupBy = { property, direction: 'ASC' }
    return next
  })
}

/** How a view is sorted, and whether the other way round. */
export function sortingOf(view: View, original: View | null): { sorting: Sorting; down: boolean } {
  if (original && same(view.sort, original.sort)) return { sorting: 'default', down: false }
  const first = view.sort[0]
  if (!first) return { sorting: 'manual', down: false }
  return {
    sorting: SORTINGS.find((one) => BY[one] === first.property) ?? 'manual',
    down: first.direction === 'DESC',
  }
}

/** The view sorted another way: by one property, then as it was written. */
export function withSorting(
  base: Base,
  at: number,
  sorting: Sorting,
  down: boolean,
  original: View | null,
): Base {
  return withView(base, at, (view) => {
    if (sorting === 'default') return { ...view, sort: original ? [...original.sort] : [] }
    const property = BY[sorting]
    if (property === undefined) return { ...view, sort: [] }
    return { ...view, sort: [{ property, direction: down ? 'DESC' : 'ASC' }] }
  })
}

/** Whether done tasks stay in the view. */
export function withCompleted(base: Base, at: number, shown: boolean): Base {
  return withView(base, at, (view) => {
    const nib = { ...view.nib }
    if (shown) nib.showCompleted = true
    else delete nib.showCompleted
    return { ...view, nib }
  })
}

/** A priority as the narrowing keeps it, or undefined for anything else. */
function priorityOf(value: unknown): Only['priority'] {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
}

/** A day as the narrowing keeps it, or undefined for anything else. */
function dateOf(value: unknown): Only['date'] {
  return value === 'overdue' || value === 'today' || value === 'week' || value === 'none'
    ? value
    : undefined
}

/** What a view is narrowed to, as its `nib.only` says. */
export function onlyOf(view: View): Only {
  const kept: unknown = view.nib.kept.only
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {}
  const priority = priorityOf(Reflect.get(kept, 'priority'))
  const label: unknown = Reflect.get(kept, 'label')
  const date = dateOf(Reflect.get(kept, 'date'))
  const project: unknown = Reflect.get(kept, 'project')
  return {
    ...(typeof project === 'string' && project ? { project } : {}),
    ...(priority === undefined ? {} : { priority }),
    ...(typeof label === 'string' && label ? { label } : {}),
    ...(date === undefined ? {} : { date }),
  }
}

/** The view narrowed to this, or to nothing. */
export function withOnly(base: Base, at: number, only: Only): Base {
  return withView(base, at, (view) => {
    const kept = { ...view.nib.kept }
    if (Object.keys(only).length) kept.only = { ...only }
    else delete kept.only
    return { ...view, nib: { ...view.nib, kept } }
  })
}

/** The narrowing as the engine's expression, or null for none. */
export function onlyFilter(only: Only): string | null {
  const parts: string[] = []
  if (only.priority !== undefined) parts.push(`task.priority == ${only.priority}`)
  if (only.label !== undefined) parts.push(`task.hasTag(${JSON.stringify(only.label)})`)
  // Only a deadline makes a task late (#371).
  if (only.date === 'overdue') parts.push('task.deadline < today()')
  else if (only.date === 'today') parts.push('task.date == today()')
  else if (only.date === 'week') parts.push('task.date >= today() && task.date <= today() + "6d"')
  else if (only.date === 'none') parts.push('!task.date')
  if (only.project !== undefined) parts.push(`file.path == ${JSON.stringify(only.project)}`)
  return parts.length ? parts.join(' && ') : null
}

/** Each base asked about once per view, so the engine, which keeps what it compiled with
 *  the base object, compiles a narrowed view once. */
const narrowed = new WeakMap<Base, Map<number, Base>>()

/** The base the engine answers a view of: the view's filters and its narrowing together. */
export function displayed(base: Base, at: number): Base {
  const view = base.views[at]
  const extra = view ? onlyFilter(onlyOf(view)) : null
  // A view grouped by note name before notes were grouped by path: two notes of one
  // name in two folders are two groups, as the Display menu's "note" now groups them.
  const byName = view?.groupBy?.property === 'file.basename' ? view.groupBy : null
  if (!view || (extra === null && !byName)) return base
  let kept = narrowed.get(base)
  const known = kept?.get(at)
  if (known) return known
  const made = withView(base, at, (one) => ({
    ...one,
    ...(extra === null ? {} : { filters: view.filters ? { and: [view.filters, extra] } : extra }),
    ...(byName ? { groupBy: { ...byName, property: GROUP_BY.note ?? 'file.path' } } : {}),
  }))
  if (!kept) narrowed.set(base, (kept = new Map<number, Base>()))
  kept.set(at, made)
  return made
}
