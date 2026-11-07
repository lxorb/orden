import { bare } from './columns'
import {
  type Base,
  type Filter,
  type OrdenBase,
  type OrdenProperty,
  type OrdenView,
  renamedLiteral,
  type Sort,
  type View,
} from '@orden/bases'

function withView(base: Base, at: number, change: (view: View) => View): Base {
  const view = base.views[at]
  if (!view) return base
  const views = [...base.views]
  views[at] = change(view)
  return { ...base, views }
}

function withNib(view: View, change: { [K in keyof OrdenView]?: OrdenView[K] | undefined }): View {
  const orden: OrdenView = { ...view.orden }
  for (const [key, value] of Object.entries(change) as [keyof OrdenView, unknown][]) {
    if (value === undefined) Reflect.deleteProperty(orden, key)
    else Reflect.set(orden, key, value)
  }
  return { ...view, orden }
}

export const setLayout = (base: Base, at: number, type: string): Base =>
  withView(base, at, (view) => ({ ...view, type }))

export const setSort = (base: Base, at: number, sort: Sort[]): Base =>
  withView(base, at, (view) => ({ ...view, sort }))

function lacking(view: View, key: 'groupBy' | 'filters'): View {
  const out = { ...view }
  Reflect.deleteProperty(out, key)
  return out
}

export const setGroup = (base: Base, at: number, group: Sort | undefined): Base =>
  withView(base, at, (view) => (group ? { ...view, groupBy: group } : lacking(view, 'groupBy')))

export const setSubGroup = (base: Base, at: number, sub: Sort | undefined): Base =>
  withView(base, at, (view) => withNib(view, { subGroupBy: sub }))

export const setFilter = (base: Base, at: number, filters: Filter | undefined): Base =>
  withView(base, at, (view) => {
    const options = { ...view.options }
    Reflect.deleteProperty(options, 'filters')
    const next = { ...view, options }
    return filters === undefined ? lacking(next, 'filters') : { ...next, filters }
  })

export const setShowCompleted = (base: Base, at: number, shown: boolean): Base =>
  withView(base, at, (view) => withNib(view, { showCompleted: shown ? true : undefined }))

export const setColumns = (base: Base, at: number, order: string[]): Base =>
  withView(base, at, (view) => ({ ...view, order }))

export function setSummary(base: Base, at: number, property: string, name: string | null): Base {
  return withView(base, at, (view) => {
    const summaries = { ...view.summaries }
    if (name === null) Reflect.deleteProperty(summaries, property)
    else summaries[property] = name
    return { ...view, summaries }
  })
}

export function setHidden(base: Base, at: number, group: string, hidden: boolean): Base {
  return withView(base, at, (view) => {
    const was = view.orden.hidden ?? []
    const next = hidden ? [...new Set([...was, group])] : was.filter((one) => one !== group)
    return withNib(view, { hidden: next.length ? next : undefined })
  })
}

export function setManualOrder(base: Base, at: number, group: string, ids: string[]): Base {
  return withView(base, at, (view) => {
    const order = {
      ...view.orden.order,
      [group]: mergedOrder(view.orden.order?.[group] ?? [], ids),
    }
    return withNib(view, { order })
  })
}

export function mergedOrder(stored: readonly string[], shown: readonly string[]): string[] {
  const shownSet = new Set(shown)
  const storedSet = new Set(stored)
  const places = stored.filter((id) => shownSet.has(id)).length
  if (places === 0) return [...stored, ...shown]
  const runs: string[][] = []
  let run: string[] = []
  let held = false
  for (const id of shown) {
    if (storedSet.has(id)) {
      if (held) {
        runs.push(run)
        run = []
      }
      held = true
    }
    run.push(id)
  }
  runs.push(run)
  let next = 0
  return stored.flatMap((id) => (shownSet.has(id) ? (runs[next++] ?? []) : [id]))
}

export function setNibOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    if (key === 'date' || key === 'end') {
      return withNib(view, { [key]: typeof value === 'string' ? value : undefined })
    }
    const kept = { ...view.orden.kept }
    if (value === undefined) Reflect.deleteProperty(kept, key)
    else kept[key] = value
    return withNib(view, { kept })
  })
}

export function freeViewName(base: Base, wanted: string): string {
  const taken = new Set(base.views.map((view) => view.name))
  if (!taken.has(wanted)) return wanted
  for (let count = 2; ; count++) {
    const name = `${wanted} ${count}`
    if (!taken.has(name)) return name
  }
}

export function addView(base: Base, at: number, type?: string): Base {
  const from = base.views[at]
  const name = freeViewName(base, from?.name.trim() ? from.name : 'View')
  const made: View = from
    ? { ...from, name, ...(type ? { type } : {}) }
    : {
        type: type ?? 'table',
        name,
        order: [],
        sort: [],
        summaries: {},
        orden: { kept: {} },
        options: {},
      }
  const views = [...base.views]
  views.splice(at + 1, 0, made)
  return { ...base, views }
}

export function renameView(base: Base, at: number, name: string): Base {
  const trimmed = name.trim()
  if (!trimmed || base.views[at]?.name === trimmed) return base
  return withView(base, at, (view) => ({ ...view, name: freeViewName(base, trimmed) }))
}

export function removeView(base: Base, at: number): Base {
  if (base.views.length < 2 || !base.views[at]) return base
  return { ...base, views: base.views.filter((_, index) => index !== at) }
}

export function setViewOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    const options = { ...view.options }
    if (value === undefined) Reflect.deleteProperty(options, key)
    else options[key] = value
    return { ...view, options }
  })
}

export function setViewNib<K extends Exclude<keyof OrdenView, 'kept'>>(
  base: Base,
  at: number,
  key: K,
  value: OrdenView[K] | undefined,
): Base {
  return withView(base, at, (view) => withNib(view, { [key]: value }))
}

export function setBaseNib<K extends 'template' | 'id' | 'locked'>(
  base: Base,
  key: K,
  value: OrdenBase[K] | undefined,
): Base {
  const orden: OrdenBase = { ...base.orden }
  if (value === undefined) Reflect.deleteProperty(orden, key)
  else Reflect.set(orden, key, value)
  return { ...base, orden }
}

export function setFormula(base: Base, name: string, source: string | null): Base {
  const formulas = { ...base.formulas }
  if (source === null) Reflect.deleteProperty(formulas, name)
  else formulas[name] = source
  return { ...base, formulas }
}

export function setProperty(
  base: Base,
  key: string,
  change: { [K in keyof OrdenProperty]?: OrdenProperty[K] | undefined },
): Base {
  const next: OrdenProperty = { ...(base.orden.properties[key] ?? { kept: {} }) }
  for (const [name, value] of Object.entries(change)) {
    if (value === undefined) Reflect.deleteProperty(next, name)
    else Reflect.set(next, name, value)
  }
  const properties = { ...base.orden.properties }
  const empty = Object.keys(next).length === 1 && !Object.keys(next.kept).length
  if (empty) Reflect.deleteProperty(properties, key)
  else properties[key] = next
  return { ...base, orden: { ...base.orden, properties } }
}

export function freeFormulaName(base: Base, wanted: string): string {
  const name = wanted.trim() || 'Formula'
  if (!(name in base.formulas)) return name
  for (let count = 2; ; count++)
    if (!(`${name} ${count}` in base.formulas)) return `${name} ${count}`
}

export function setDisplayName(base: Base, column: string, words: string): Base {
  const key = column.startsWith('note.') ? column.slice(5) : column
  const was = base.properties[key] ?? base.properties[column] ?? { kept: {} }
  const next = { ...was }
  if (words.trim()) next.displayName = words.trim()
  else Reflect.deleteProperty(next, 'displayName')
  const properties = { ...base.properties }
  Reflect.deleteProperty(properties, column)
  if (next.displayName === undefined && !Object.keys(next.kept).length)
    Reflect.deleteProperty(properties, key)
  else properties[key] = next
  return { ...base, properties }
}

export function renamedGroup(
  base: Base,
  property: string,
  from: string,
  to: string,
  merge = false,
): Base {
  if (from === to) return base
  const name = property.replace(/^note\./, '')
  const swap = (list: readonly string[]) => [
    ...new Set(list.map((one) => (one === from ? to : one))),
  ]
  const literal = (filter: Filter): Filter => {
    if (typeof filter === 'string') return renamedLiteral(filter, name, from, to)
    if ('and' in filter) return { and: filter.and.map(literal) }
    if ('or' in filter) return { or: filter.or.map(literal) }
    return { not: filter.not.map(literal) }
  }
  const same = (one: string | undefined) => one !== undefined && bare(one) === name
  const views = base.views.map((view): View => {
    if (!same(view.groupBy?.property) && !same(view.orden.subGroupBy?.property))
      return { ...view, ...(view.filters ? { filters: literal(view.filters) } : {}) }
    const order = view.orden.order
    let moved = order
    if (order && from in order) {
      const { [from]: carried = [], ...rest } = order
      moved = { ...rest, [to]: [...new Set([...(rest[to] ?? []), ...carried])] }
    }
    const hidden = view.orden.hidden
      ? merge
        ? view.orden.hidden.filter((one) => one !== from)
        : swap(view.orden.hidden)
      : undefined
    return {
      ...view,
      ...(view.filters ? { filters: literal(view.filters) } : {}),
      orden: {
        ...view.orden,
        ...(moved ? { order: moved } : {}),
        ...(hidden ? { hidden } : {}),
        ...(view.orden.groups ? { groups: swap(view.orden.groups) } : {}),
      },
    }
  })
  return { ...base, views, ...(base.filters ? { filters: literal(base.filters) } : {}) }
}

export function forgottenGroup(base: Base, property: string, value: string): Base {
  const name = bare(property)
  const same = (one: string | undefined) => one !== undefined && bare(one) === name
  const views = base.views.map((view): View => {
    if (!same(view.groupBy?.property) && !same(view.orden.subGroupBy?.property)) return view
    const orden = { ...view.orden }
    if (orden.order && value in orden.order) {
      orden.order = Object.fromEntries(Object.entries(orden.order).filter(([key]) => key !== value))
    }
    if (orden.hidden) orden.hidden = orden.hidden.filter((one) => one !== value)
    if (orden.groups) orden.groups = orden.groups.filter((one) => one !== value)
    return { ...view, orden }
  })
  return { ...base, views }
}

export function placeColumn(
  base: Base,
  at: number,
  names: readonly string[],
  moving: string,
  target: string,
  after: boolean,
): Base {
  if (moving === target) return base
  const rest = names.filter((one) => one !== moving)
  const index = rest.indexOf(target)
  if (index === -1) return base
  rest.splice(after ? index + 1 : index, 0, moving)
  return setViewNib(base, at, 'groups', rest)
}

export function prunedOrder(base: Base, at: number, group: string, alive: (id: string) => boolean) {
  return withView(base, at, (view) => {
    const was = view.orden.order?.[group]
    if (!was) return view
    const kept = was.filter(alive)
    if (kept.length === was.length) return view
    const order = { ...view.orden.order }
    if (kept.length) order[group] = kept
    else Reflect.deleteProperty(order, group)
    return withNib(view, { order: Object.keys(order).length ? order : undefined })
  })
}
