/** A base changed the way a view's head changes it: a layout, a sort, a grouping, a
 *  filter, a column, a view added, renamed or taken away.
 *
 *  Never in place. The engine keeps a compiled view per base object (see `answer` in
 *  @nib/bases), so a base that changed under it would answer with the filter it had
 *  before; every edit here makes a new base, sharing whatever it did not touch, and
 *  the tab answers the new one afresh. Pure, so each is a line of a test. */

import { bare } from './columns'
import type { Base, Filter, NibBase, NibProperty, NibView, Sort, View } from '@nib/bases'

/** The base with one of its views replaced. A place past the end changes nothing. */
function withView(base: Base, at: number, change: (view: View) => View): Base {
  const view = base.views[at]
  if (!view) return base
  const views = [...base.views]
  views[at] = change(view)
  return { ...base, views }
}

/** The view with some of nib's own keys changed; undefined takes one away. */
function withNib(view: View, change: { [K in keyof NibView]?: NibView[K] | undefined }): View {
  const nib: NibView = { ...view.nib }
  // `Object.entries` widens the keys to string; they are the change's own, which are
  // NibView's by the parameter's type.
  for (const [key, value] of Object.entries(change) as [keyof NibView, unknown][]) {
    if (value === undefined) Reflect.deleteProperty(nib, key)
    else Reflect.set(nib, key, value)
  }
  return { ...view, nib }
}

export const setLayout = (base: Base, at: number, type: string): Base =>
  withView(base, at, (view) => ({ ...view, type }))

export const setSort = (base: Base, at: number, sort: Sort[]): Base =>
  withView(base, at, (view) => ({ ...view, sort }))

/** A view without one of its optional keys. */
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
  withView(base, at, (view) =>
    filters === undefined ? lacking(view, 'filters') : { ...view, filters },
  )

export const setShowCompleted = (base: Base, at: number, shown: boolean): Base =>
  withView(base, at, (view) => withNib(view, { showCompleted: shown ? true : undefined }))

/** The columns a view shows, in order. */
export const setColumns = (base: Base, at: number, order: string[]): Base =>
  withView(base, at, (view) => ({ ...view, order }))

/** A summary under a column, or none. */
export function setSummary(base: Base, at: number, property: string, name: string | null): Base {
  return withView(base, at, (view) => {
    const summaries = { ...view.summaries }
    if (name === null) Reflect.deleteProperty(summaries, property)
    else summaries[property] = name
    return { ...view, summaries }
  })
}

/** A group kept out of sight, or shown again. */
export function setHidden(base: Base, at: number, group: string, hidden: boolean): Base {
  return withView(base, at, (view) => {
    const was = view.nib.hidden ?? []
    const next = hidden ? [...new Set([...was, group])] : was.filter((one) => one !== group)
    return withNib(view, { hidden: next.length ? next : undefined })
  })
}

/** A group's manual order, as the board keeps it: row ids, first to last. `ids` are
 *  the cards on screen in their new order, which may be only some of the group's (a
 *  search, a filter, the limit or one swimlane hides the rest): those take the places
 *  the shown ones held, and every other card keeps its own. */
export function setManualOrder(base: Base, at: number, group: string, ids: string[]): Base {
  return withView(base, at, (view) => {
    const order = { ...view.nib.order, [group]: mergedOrder(view.nib.order?.[group] ?? [], ids) }
    return withNib(view, { order })
  })
}

/** A stored order with the shown cards put in their new order. Each shown card the
 *  stored order already had marks a place; the shown cards fill those places in their
 *  new order, a card new to the order going in next to the one before it on screen. */
export function mergedOrder(stored: readonly string[], shown: readonly string[]): string[] {
  const shownSet = new Set(shown)
  const storedSet = new Set(stored)
  const places = stored.filter((id) => shownSet.has(id)).length
  if (places === 0) return [...stored, ...shown]
  // The shown cards in runs, one run per place: a run starts at each card the stored
  // order had, so the new cards ride with their neighbour.
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

/** A key of a layout's own: a calendar's date, a chart's measure. Kept under the
 *  view's `nib:` so Obsidian leaves it alone. */
export function setNibOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    if (key === 'date' || key === 'end') {
      return withNib(view, { [key]: typeof value === 'string' ? value : undefined })
    }
    const kept = { ...view.nib.kept }
    if (value === undefined) Reflect.deleteProperty(kept, key)
    else kept[key] = value
    return withNib(view, { kept })
  })
}

/** A name no other view of the base has: the one asked for, or it with a number. */
export function freeViewName(base: Base, wanted: string): string {
  const taken = new Set(base.views.map((view) => view.name))
  if (!taken.has(wanted)) return wanted
  for (let count = 2; ; count++) {
    const name = `${wanted} ${count}`
    if (!taken.has(name)) return name
  }
}

/** Another view after the one at `at`: a copy of it, or a fresh one of a layout. */
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
        nib: { kept: {} },
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

/** A view taken away; the last view of a base is never taken. */
export function removeView(base: Base, at: number): Base {
  if (base.views.length < 2 || !base.views[at]) return base
  return { ...base, views: base.views.filter((_, index) => index !== at) }
}

/** A key of the view Obsidian itself writes beside `type` (`columnSize`, `image`,
 *  `cardSize`), set or taken away. */
export function setViewOption(base: Base, at: number, key: string, value: unknown): Base {
  return withView(base, at, (view) => {
    const options = { ...view.options }
    if (value === undefined) Reflect.deleteProperty(options, key)
    else options[key] = value
    return { ...view, options }
  })
}

/** One of nib's own keys of a view (`lines`, `freeze`, `colour`, `template`, `required`,
 *  `locked`), set or, with undefined, taken away. */
export function setViewNib<K extends Exclude<keyof NibView, 'kept'>>(
  base: Base,
  at: number,
  key: K,
  value: NibView[K] | undefined,
): Base {
  return withView(base, at, (view) => withNib(view, { [key]: value }))
}

/** The base's nib keys with one changed: its default template, its ids, its lock. */
export function setBaseNib<K extends 'template' | 'id' | 'locked'>(
  base: Base,
  key: K,
  value: NibBase[K] | undefined,
): Base {
  const nib: NibBase = { ...base.nib }
  if (value === undefined) Reflect.deleteProperty(nib, key)
  else Reflect.set(nib, key, value)
  return { ...base, nib }
}

/** A formula made, changed or (null) taken away. */
export function setFormula(base: Base, name: string, source: string | null): Base {
  const formulas = { ...base.formulas }
  if (source === null) Reflect.deleteProperty(formulas, name)
  else formulas[name] = source
  return { ...base, formulas }
}

/** What nib says about one property (`nib.properties.<key>`): its options, its format. */
export function setProperty(
  base: Base,
  key: string,
  change: { [K in keyof NibProperty]?: NibProperty[K] | undefined },
): Base {
  const next: NibProperty = { ...(base.nib.properties[key] ?? { kept: {} }) }
  for (const [name, value] of Object.entries(change)) {
    if (value === undefined) Reflect.deleteProperty(next, name)
    else Reflect.set(next, name, value)
  }
  const properties = { ...base.nib.properties }
  const empty = Object.keys(next).length === 1 && !Object.keys(next.kept).length
  if (empty) Reflect.deleteProperty(properties, key)
  else properties[key] = next
  return { ...base, nib: { ...base.nib, properties } }
}

/** A name no formula of the base has yet: the one asked for, or it with a number. */
export function freeFormulaName(base: Base, wanted: string): string {
  const name = wanted.trim() || 'Formula'
  if (!(name in base.formulas)) return name
  for (let count = 2; ; count++)
    if (!(`${name} ${count}` in base.formulas)) return `${name} ${count}`
}

/** What a column is called in this base (Bases' `properties.<key>.displayName`), under
 *  the key Bases writes it with: a note's property by its own name, anything else by
 *  its whole one. Empty words take the name away. */
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

/** A group renamed in every key a base keeps it under: each view's manual order, its
 *  hidden groups and its column order, and a filter's literal of it, so a column whose
 *  option was renamed keeps its cards' order, stays hidden and stays where it was. With
 *  `merge`, `to` is a group already, and `from`'s cards join it. */
export function renamedGroup(
  base: Base,
  property: string,
  from: string,
  to: string,
  merge = false,
): Base {
  if (from === to) return base
  const name = property.replace(/^note\./, '')
  // A rename onto a name that is already a group is a merge: the two lists are one,
  // the target's first, and a name is never there twice.
  const swap = (list: readonly string[]) => [
    ...new Set(list.map((one) => (one === from ? to : one))),
  ]
  const quoted = (words: string) => JSON.stringify(words)
  const literal = (filter: Filter): Filter => {
    if (typeof filter === 'string')
      return filter.includes(name) ? filter.split(quoted(from)).join(quoted(to)) : filter
    if ('and' in filter) return { and: filter.and.map(literal) }
    if ('or' in filter) return { or: filter.or.map(literal) }
    return { not: filter.not.map(literal) }
  }
  const same = (one: string | undefined) => one !== undefined && bare(one) === name
  const views = base.views.map((view): View => {
    if (!same(view.groupBy?.property) && !same(view.nib.subGroupBy?.property))
      return { ...view, ...(view.filters ? { filters: literal(view.filters) } : {}) }
    const order = view.nib.order
    let moved = order
    if (order && from in order) {
      const { [from]: carried = [], ...rest } = order
      moved = { ...rest, [to]: [...new Set([...(rest[to] ?? []), ...carried])] }
    }
    // A merge goes into the target as it is, shown or hidden; a rename keeps hiding
    // what was hidden.
    const hidden = view.nib.hidden
      ? merge
        ? view.nib.hidden.filter((one) => one !== from)
        : swap(view.nib.hidden)
      : undefined
    return {
      ...view,
      ...(view.filters ? { filters: literal(view.filters) } : {}),
      nib: {
        ...view.nib,
        ...(moved ? { order: moved } : {}),
        ...(hidden ? { hidden } : {}),
        ...(view.nib.groups ? { groups: swap(view.nib.groups) } : {}),
      },
    }
  })
  return { ...base, views, ...(base.filters ? { filters: literal(base.filters) } : {}) }
}

/** A group gone from every key a base keeps it under, its option deleted: so one made
 *  again under that name starts shown, unordered and at the end. */
export function forgottenGroup(base: Base, property: string, value: string): Base {
  const name = bare(property)
  const same = (one: string | undefined) => one !== undefined && bare(one) === name
  const views = base.views.map((view): View => {
    if (!same(view.groupBy?.property) && !same(view.nib.subGroupBy?.property)) return view
    const nib = { ...view.nib }
    if (nib.order && value in nib.order) {
      nib.order = Object.fromEntries(Object.entries(nib.order).filter(([key]) => key !== value))
    }
    if (nib.hidden) nib.hidden = nib.hidden.filter((one) => one !== value)
    if (nib.groups) nib.groups = nib.groups.filter((one) => one !== value)
    return { ...view, nib }
  })
  return { ...base, views }
}

/** A board's columns in a new order: `moving` put before or after `target`, among the
 *  columns as they stand (`names`, by key as text). */
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

/** A group's manual order with the ids of rows no longer anywhere left out. */
export function prunedOrder(base: Base, at: number, group: string, alive: (id: string) => boolean) {
  return withView(base, at, (view) => {
    const was = view.nib.order?.[group]
    if (!was) return view
    const kept = was.filter(alive)
    if (kept.length === was.length) return view
    const order = { ...view.nib.order }
    if (kept.length) order[group] = kept
    else Reflect.deleteProperty(order, group)
    return withNib(view, { order: Object.keys(order).length ? order : undefined })
  })
}
