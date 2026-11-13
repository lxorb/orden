import {
  type Base,
  isWhen,
  type Row,
  SMART_SORT,
  type View,
  isWhenFormula,
  WHEN,
  WHEN_ASIDE,
  WHEN_GROUPS,
} from '@orden/bases'

export type Grouping =
  'default' | 'none' | 'date' | 'deadline' | 'priority' | 'tag' | 'due' | 'status'
export type Sorting =
  'default' | 'smart' | 'manual' | 'name' | 'date' | 'deadline' | 'priority' | 'created'

export const GROUPINGS: readonly Grouping[] = [
  'default',
  'none',
  'date',
  'deadline',
  'priority',
  'tag',
  'due',
  'status',
]
export const SORTINGS: readonly Sorting[] = [
  'default',
  'smart',
  'manual',
  'name',
  'date',
  'deadline',
  'priority',
  'created',
]

export const GROUPS_OFFERED: readonly Grouping[] = ['none', 'priority', 'tag', 'due', 'status']

export const SORTS_OFFERED: readonly Sorting[] = [
  'smart',
  'deadline',
  'priority',
  'name',
  'created',
  'manual',
]

const BY: Partial<Record<Grouping | Sorting, string>> = {
  date: 'task.date',
  deadline: 'task.deadline',
  priority: 'task.priority',
  name: 'task.text',
  created: 'task.created',
}

const GROUP_BY: Partial<Record<Grouping, string>> = {
  ...BY,
  tag: 'task.tags',
  due: 'formula.when',
  status: 'task.status',
}

export interface Only {
  priority?: 1 | 2 | 3 | 4
  label?: string
  date?: 'overdue' | 'today' | 'week' | 'none'
  created?: 'today' | 'week' | 'month'
  assignee?: string
  space?: string
}

export const ASSIGNED_TO_ME = ':me'
export const UNASSIGNED = ':none'

export function assigneesOf(rows: readonly Row[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) if (row.task?.assignee) seen.add(row.task.assignee)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export function spacesIn(rows: readonly Row[], order: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) if (row.task) seen.add(row.space)
  const at = (name: string) => {
    const index = order.indexOf(name)
    return index === -1 ? order.length : index
  }
  return [...seen].sort((a, b) => at(a) - at(b) || a.localeCompare(b))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const whenName = (base: Base) =>
  base.formulas.when === undefined || isWhenFormula(base.formulas.when) ? 'when' : WHEN_ASIDE

function withView(base: Base, at: number, change: (view: View) => View, when = false): Base {
  const view = base.views[at]
  if (!view) return base
  const name = whenName(base)
  const kept = base.formulas[name]
  const formulas = when
    ? { ...base.formulas, [name]: kept !== undefined && isWhenFormula(kept) ? kept : WHEN }
    : base.formulas
  return {
    ...base,
    formulas,
    views: base.views.map((one, index) => (index === at ? change(view) : one)),
  }
}

export function groupingOf(view: View, original: View | null): Grouping {
  if (original && same(view.groupBy, original.groupBy)) return 'default'
  const by = view.groupBy?.property
  if (by === undefined) return 'none'
  if (isWhen(by)) return 'due'
  return GROUPINGS.find((one) => GROUP_BY[one] === by) ?? 'none'
}

export function withGrouping(
  base: Base,
  at: number,
  grouping: Grouping,
  original: View | null,
): Base {
  return withView(
    base,
    at,
    (view) => {
      const orden = { ...view.orden }
      delete orden.groupOrder
      delete orden.groups
      const next: View = { ...view, orden }
      delete next.groupBy
      if (grouping === 'default') {
        if (original?.groupBy) next.groupBy = original.groupBy
        if (original?.orden.groupOrder) orden.groupOrder = original.orden.groupOrder
        if (original?.orden.groups) orden.groups = [...original.orden.groups]
        return next
      }
      const property = grouping === 'due' ? `formula.${whenName(base)}` : GROUP_BY[grouping]
      if (property === undefined) return next
      if (grouping === 'due') orden.groups = [...WHEN_GROUPS]
      next.groupBy = { property, direction: 'ASC' }
      return next
    },
    grouping === 'due',
  )
}

export function shippedGrouping(original: View | null): Grouping {
  if (!original) return 'none'
  const by = original.groupBy?.property
  if (by === undefined) return 'none'
  return GROUPINGS.find((one) => one !== 'default' && GROUP_BY[one] === by) ?? 'default'
}

export function shippedSorting(original: View | null): Sorting {
  if (!original?.sort.length) return 'manual'
  if (same(original.sort, SMART_SORT)) return 'smart'
  if (original.sort.length > 1) return 'default'
  return (
    SORTINGS.find((one) => one !== 'default' && BY[one] === original.sort[0]?.property) ?? 'default'
  )
}

export function changedFrom(
  view: View,
  original: View | null,
): { sort: number; filter: number; total: number } {
  const filter = Object.keys(onlyOf(view)).length
  if (!original) return { sort: 0, filter, total: filter }
  const grouping = groupingOf(view, original)
  const sorting = sortingOf(view, original).sorting
  const sort =
    (grouping === 'default' || grouping === shippedGrouping(original) ? 0 : 1) +
    (sorting === 'default' || sorting === shippedSorting(original) ? 0 : 1)
  const layout = original.type === view.type ? 0 : 1
  const done =
    (view.orden.showCompleted ?? false) === (original.orden.showCompleted ?? false) ? 0 : 1
  return { sort, filter, total: sort + filter + layout + done }
}

export function sortingOf(view: View, original: View | null): { sorting: Sorting; down: boolean } {
  if (original && same(view.sort, original.sort)) return { sorting: 'default', down: false }
  if (same(view.sort, SMART_SORT)) return { sorting: 'smart', down: false }
  const first = view.sort[0]
  if (!first) return { sorting: 'manual', down: false }
  return {
    sorting: SORTINGS.find((one) => BY[one] === first.property) ?? 'manual',
    down: first.direction === 'DESC',
  }
}

export function withSorting(
  base: Base,
  at: number,
  sorting: Sorting,
  down: boolean,
  original: View | null,
): Base {
  return withView(base, at, (view) => {
    if (sorting === 'default') return { ...view, sort: original ? [...original.sort] : [] }
    if (sorting === 'smart') return { ...view, sort: [...SMART_SORT] }
    const property = BY[sorting]
    if (property === undefined) return { ...view, sort: [] }
    return { ...view, sort: [{ property, direction: down ? 'DESC' : 'ASC' }] }
  })
}

export function withCompleted(base: Base, at: number, shown: boolean): Base {
  return withView(base, at, (view) => {
    const orden = { ...view.orden }
    if (shown) orden.showCompleted = true
    else delete orden.showCompleted
    return { ...view, orden }
  })
}

function priorityOf(value: unknown): Only['priority'] {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
}

function dateOf(value: unknown): Only['date'] {
  return value === 'overdue' || value === 'today' || value === 'week' || value === 'none'
    ? value
    : undefined
}

export function onlyOf(view: View): Only {
  const kept: unknown = view.orden.kept.only
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {}
  const priority = priorityOf(Reflect.get(kept, 'priority'))
  const label: unknown = Reflect.get(kept, 'label')
  const date = dateOf(Reflect.get(kept, 'date'))
  const created: unknown = Reflect.get(kept, 'created')
  const assignee: unknown = Reflect.get(kept, 'assignee')
  const space: unknown = Reflect.get(kept, 'space')
  return {
    ...(typeof space === 'string' && space ? { space } : {}),
    ...(created === 'today' || created === 'week' || created === 'month' ? { created } : {}),
    ...(typeof assignee === 'string' && assignee ? { assignee } : {}),
    ...(priority === undefined ? {} : { priority }),
    ...(typeof label === 'string' && label ? { label } : {}),
    ...(date === undefined ? {} : { date }),
  }
}

export function withOnly(base: Base, at: number, only: Only): Base {
  return withView(base, at, (view) => {
    const kept = { ...view.orden.kept }
    if (Object.keys(only).length) kept.only = { ...only }
    else delete kept.only
    return { ...view, orden: { ...view.orden, kept } }
  })
}

export function onlyFilter(only: Only): string | null {
  const parts: string[] = []
  if (only.space !== undefined) parts.push(`file.space == ${JSON.stringify(only.space)}`)
  if (only.priority !== undefined) parts.push(`task.priority == ${only.priority}`)
  if (only.label !== undefined) parts.push(`task.hasTag(${JSON.stringify(only.label)})`)
  if (only.date === 'overdue') parts.push('task.deadline < today()')
  else if (only.date === 'today') parts.push('task.date == today()')
  else if (only.date === 'week') parts.push('task.date >= today() && task.date <= today() + "6d"')
  else if (only.date === 'none') parts.push('!task.date')
  if (only.created === 'today') parts.push('task.created == today()')
  else if (only.created === 'week') parts.push('task.created >= today() - "6d"')
  else if (only.created === 'month') parts.push('task.created >= today() - "29d"')
  if (only.assignee === ASSIGNED_TO_ME) parts.push('task.mine')
  else if (only.assignee === UNASSIGNED) parts.push('!task.assignee')
  else if (only.assignee !== undefined)
    parts.push(`task.assignee == ${JSON.stringify(only.assignee)}`)
  return parts.length ? parts.join(' && ') : null
}

export function narrowing(view: View | null | undefined): Only {
  return view ? onlyOf(view) : {}
}

const narrowed = new WeakMap<Base, Map<number, Base>>()

export function displayed(base: Base, at: number): Base {
  const view = base.views[at]
  const extra = view ? onlyFilter(onlyOf(view)) : null
  if (!view || extra === null) return base
  let kept = narrowed.get(base)
  const known = kept?.get(at)
  if (known) return known
  const made = withView(base, at, (one) => ({
    ...one,
    filters: view.filters ? { and: [view.filters, extra] } : extra,
  }))
  if (!kept) narrowed.set(base, (kept = new Map<number, Base>()))
  kept.set(at, made)
  return made
}
