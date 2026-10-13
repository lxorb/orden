/** Todoist's Display menu over a view of tasks: how it is grouped, how it is sorted and
 *  which way, whether done tasks stay, and what it is narrowed to - a priority, a label,
 *  a day. Each answer is a new base, so the change is kept where the view keeps its
 *  changes (a built-in view in its tab, a base in its file), and Obsidian reads every key
 *  it knows: the grouping and the sorting are Bases' own, the narrowing nib's under the
 *  view's `nib:` key (`only`), which Obsidian leaves alone.
 *
 *  Pure. `displayed` is what the engine is asked with: the view's own filters and the
 *  narrowing together. */

import type { Base, Filter, View } from '@nib/bases'

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

/** What a view is narrowed to. */
export interface Only {
  priority?: 1 | 2 | 3 | 4
  label?: string
  date?: 'overdue' | 'today' | 'week' | 'none'
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
  return GROUPINGS.find((one) => BY[one] === by) ?? 'none'
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
    const property = BY[grouping]
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
  return {
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
  if (only.date === 'overdue') parts.push('task.date < today()')
  else if (only.date === 'today') parts.push('task.date == today()')
  else if (only.date === 'week') parts.push('task.date >= today() && task.date <= today() + "6d"')
  else if (only.date === 'none') parts.push('!task.date')
  return parts.length ? parts.join(' && ') : null
}

/** Each base asked about once per view, so the engine, which keeps what it compiled with
 *  the base object, compiles a narrowed view once. */
const narrowed = new WeakMap<Base, Map<number, Base>>()

/** The base the engine answers a view of: the view's filters and its narrowing together. */
export function displayed(base: Base, at: number): Base {
  const view = base.views[at]
  const extra = view ? onlyFilter(onlyOf(view)) : null
  if (!view || extra === null) return base
  let kept = narrowed.get(base)
  const known = kept?.get(at)
  if (known) return known
  const filters: Filter = view.filters ? { and: [view.filters, extra] } : extra
  const made = withView(base, at, (one) => ({ ...one, filters }))
  if (!kept) narrowed.set(base, (kept = new Map<number, Base>()))
  kept.set(at, made)
  return made
}
