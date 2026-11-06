import {
  type Base,
  isWhen,
  placeOfKey,
  type Row,
  SMART_SORT,
  type View,
  WHEN,
  WHEN_ASIDE,
  WHEN_GROUPS,
} from '@orden/bases'

export type Grouping =
  | 'default'
  | 'none'
  | 'note'
  | 'section'
  | 'date'
  | 'deadline'
  | 'priority'
  | 'tag'
  | 'due'
  | 'status'
export type Sorting =
  'default' | 'smart' | 'manual' | 'name' | 'date' | 'deadline' | 'priority' | 'note' | 'created'

export const GROUPINGS: readonly Grouping[] = [
  'default',
  'none',
  'note',
  'section',
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
  'note',
  'created',
]

export function groupingsFor(project: boolean): Grouping[] {
  return [
    'none',
    ...(project ? (['section'] as const) : []),
    'priority',
    'tag',
    'due',
    ...(project ? [] : (['note'] as const)),
    'status',
  ]
}

export const SORTS_OFFERED: readonly Sorting[] = [
  'smart',
  'deadline',
  'priority',
  'name',
  'created',
  'manual',
]

const BY: Partial<Record<Grouping | Sorting, string>> = {
  note: 'file.basename',
  section: 'task.section',
  date: 'task.date',
  deadline: 'task.deadline',
  priority: 'task.priority',
  name: 'task.text',
  created: 'task.created',
}

const GROUP_BY: Partial<Record<Grouping, string>> = {
  ...BY,
  note: 'file.path',
  tag: 'task.tags',
  due: 'formula.when',
  status: 'task.status',
}

export interface Only {
  priority?: 1 | 2 | 3 | 4
  label?: string
  date?: 'overdue' | 'today' | 'week' | 'none'
  project?: string
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

export function notesIn(rows: readonly Row[]): { path: string; name: string }[] {
  const tasks = rows.filter((row) => row.task)
  const many = tasks.some((row) => row.space !== tasks[0]?.space)
  const seen = new Map<string, { space: string; name: string }>()
  for (const row of tasks)
    seen.set(many ? `${row.space}//${row.path}` : row.path, {
      space: row.space,
      name: row.file.basename,
    })
  const named = new Map<string, number>()
  for (const { name } of seen.values()) named.set(name, (named.get(name) ?? 0) + 1)
  return [...seen]
    .map(([path, { space, name }]) => ({
      path,
      name: many && (named.get(name) ?? 0) > 1 ? `${name} · ${space}` : name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const whenName = (base: Base) =>
  base.formulas.when === undefined || base.formulas.when === WHEN ? 'when' : WHEN_ASIDE

function withView(base: Base, at: number, change: (view: View) => View, when = false): Base {
  const view = base.views[at]
  if (!view) return base
  const formulas = when ? { ...base.formulas, [whenName(base)]: WHEN } : base.formulas
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
  if (by === 'file.basename') return 'note'
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
      const nib = { ...view.nib }
      delete nib.groupOrder
      delete nib.groups
      const next: View = { ...view, nib }
      delete next.groupBy
      if (grouping === 'default') {
        if (original?.groupBy) next.groupBy = original.groupBy
        if (original?.nib.groupOrder) nib.groupOrder = original.nib.groupOrder
        if (original?.nib.groups) nib.groups = [...original.nib.groups]
        return next
      }
      const property = grouping === 'due' ? `formula.${whenName(base)}` : GROUP_BY[grouping]
      if (property === undefined) return next
      if (grouping === 'section') nib.groupOrder = 'rows'
      if (grouping === 'due') nib.groups = [...WHEN_GROUPS]
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
  const done = (view.nib.showCompleted ?? false) === (original.nib.showCompleted ?? false) ? 0 : 1
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
    const nib = { ...view.nib }
    if (shown) nib.showCompleted = true
    else delete nib.showCompleted
    return { ...view, nib }
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
  const kept: unknown = view.nib.kept.only
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return {}
  const priority = priorityOf(Reflect.get(kept, 'priority'))
  const label: unknown = Reflect.get(kept, 'label')
  const date = dateOf(Reflect.get(kept, 'date'))
  const project: unknown = Reflect.get(kept, 'project')
  const created: unknown = Reflect.get(kept, 'created')
  const assignee: unknown = Reflect.get(kept, 'assignee')
  const space: unknown = Reflect.get(kept, 'space')
  return {
    ...(typeof space === 'string' && space ? { space } : {}),
    ...(created === 'today' || created === 'week' || created === 'month' ? { created } : {}),
    ...(typeof assignee === 'string' && assignee ? { assignee } : {}),
    ...(typeof project === 'string' && project ? { project } : {}),
    ...(priority === undefined ? {} : { priority }),
    ...(typeof label === 'string' && label ? { label } : {}),
    ...(date === undefined ? {} : { date }),
  }
}

export function withOnly(base: Base, at: number, only: Only): Base {
  return withView(base, at, (view) => {
    const kept = { ...view.nib.kept }
    if (Object.keys(only).length) kept.only = { ...only }
    else delete kept.only
    return { ...view, nib: { ...view.nib, kept } }
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
  if (only.project !== undefined) {
    const { space, path } = placeOfKey(only.project)
    if (space !== null) parts.push(`file.space == ${JSON.stringify(space)}`)
    parts.push(`file.path == ${JSON.stringify(path)}`)
  }
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
