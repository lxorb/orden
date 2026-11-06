import { compile, formulaReader } from './expr/compile'
import { refusing, underGuard } from './expr/pattern'
import { fieldOf, type Scope, settled, sortCompare, text, type Val } from './expr/runtime'
import { compileFilters } from './filter'
import { summarize } from './summaries'
import type { Answer, Base, Context, Group, Row, Sort, Value, View } from './types'
import { BasesError } from './errors'

interface RowFacts {
  pass: boolean
  sort: Val[]
  group: Val
  sub: Val
  words: string | null
}

interface Getter {
  run: (scope: Scope) => Val
  local: boolean
  clock: boolean
}

function getter(property: string): Getter {
  try {
    const compiled = compile(property)
    return {
      local: compiled.local,
      clock: compiled.clock,
      run: (scope) => {
        try {
          return compiled.run(scope)
        } catch {
          return null
        }
      },
    }
  } catch (error) {
    if (!(error instanceof BasesError)) throw error
    if (property.startsWith('formula.')) {
      const formula = property.slice(8)
      return {
        local: false,
        clock: true,
        run: (scope) => {
          try {
            return scope.row ? scope.formula(formula, scope.row) : null
          } catch {
            return null
          }
        },
      }
    }
    const name = property.replace(/^note\./, '')
    return {
      local: true,
      clock: false,
      run: (scope) => (scope.row ? fieldOf(scope.row.note, name) : null),
    }
  }
}

const NONE: Getter = { local: true, clock: false, run: () => null }

export function viewOf(base: Base, view: string | number | undefined): View | undefined {
  if (typeof view === 'number') return base.views[view]
  return base.views.find((one) => one.name === view) ?? base.views[0]
}

export function groupName(key: Value): string {
  return key === null ? '' : text(key)
}

function spacedPath(space: string, path: string): string {
  return `${space}//${path}`
}

export function placeOfKey(key: string): { space: string | null; path: string } {
  const at = key.lastIndexOf('//')
  return at === -1
    ? { space: null, path: key }
    : { space: key.slice(0, at), path: key.slice(at + 2) }
}

function byNoteName(a: string, b: string): number {
  const name = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return sortCompare(name(a), name(b)) || sortCompare(a, b)
}

function optionOrder(base: Base, property: string | undefined): string[] {
  if (!property) return []
  const key = property.replace(/^note\./, '')
  return base.nib.properties[key]?.options?.map((option) => option.value) ?? []
}

export interface CompiledView {
  view: View
  answer: (rows: readonly Row[], context: Context) => Answer
}

const DEFAULT_VIEW: View = {
  type: 'table',
  name: '',
  order: [],
  sort: [],
  summaries: {},
  nib: { kept: {} },
  options: {},
}

export function compileView(base: Base, which?: string | number): CompiledView {
  const view = viewOf(base, which) ?? DEFAULT_VIEW
  const filter = compileFilters(base.filters, view.filters)
  const sorts = view.sort.map((sort) => ({
    get: getter(sort.property),
    descending: sort.direction === 'DESC',
  }))
  const group = view.groupBy ? getter(view.groupBy.property) : NONE
  const sub = view.nib.subGroupBy ? getter(view.nib.subGroupBy.property) : NONE
  const shown = view.order.map(getter)
  const formulas = Object.values(base.formulas).flatMap((source) => {
    try {
      return [compile(source)]
    } catch {
      return []
    }
  })
  const getters = [group, sub, ...sorts.map((one) => one.get), ...shown]
  const local = filter.local && [...formulas, ...getters].every((one) => one.local)
  const clock = filter.clock || [...formulas, ...getters].some((one) => one.clock)

  const kinds = view.nib.rows ?? 'notes'
  const fanOut =
    view.type === 'kanban' || view.type === 'board' || view.groupBy?.property === 'task.tags'
  const showCompleted = view.nib.showCompleted ?? false
  let facts = new WeakMap<Row, RowFacts>()
  let factsFor = ''

  const answer = (rows: readonly Row[], context: Context): Answer => {
    const key = [
      context.today,
      clock ? context.now : '',
      context.this?.path ?? '',
      context.this?.space ?? '',
      context.me ?? '',
    ].join('\n')
    if (!local || key !== factsFor) {
      facts = new WeakMap()
      factsFor = key
    }
    const read = formulaReader(base.formulas)
    const scope: Scope = {
      row: null,
      context,
      locals: null,
      formula: (name, row) => read(name, row, scope),
    }
    const words = (context.search ?? '').toLowerCase().split(/\s+/).filter(Boolean)

    const factsOf = (row: Row): RowFacts => {
      const known = facts.get(row)
      if (known) return known
      scope.row = row
      const pass = filter.test(scope)
      const made: RowFacts = pass
        ? {
            pass,
            sort: sorts.map((one) => one.get.run(scope)),
            group: group.run(scope),
            sub: sub.run(scope),
            words: null,
          }
        : { pass, sort: [], group: null, sub: null, words: null }
      facts.set(row, made)
      return made
    }

    const wordsOf = (row: Row, one: RowFacts): string => {
      if (one.words === null) {
        scope.row = row
        one.words = [
          row.file.basename,
          row.task?.text ?? '',
          ...shown.map((get) => text(get.run(scope))),
        ]
          .join('\n')
          .toLowerCase()
      }
      return one.words
    }

    const kept: { row: Row; facts: RowFacts; at: number }[] = []
    rows.forEach((row, at) => {
      if (kinds === 'notes' && row.kind !== 'note') return
      if (kinds === 'tasks' && row.kind !== 'task') return
      if (!showCompleted && row.task && (row.task.done || row.task.cancelled)) return
      const one = factsOf(row)
      if (!one.pass) return
      if (words.length && !words.every((word) => wordsOf(row, one).includes(word))) return
      kept.push({ row, facts: one, at })
    })

    kept.sort((a, b) => {
      for (let index = 0; index < sorts.length; index++) {
        const order = sortCompare(a.facts.sort[index] ?? null, b.facts.sort[index] ?? null)
        if (order !== 0) {
          const nullLast = a.facts.sort[index] === null || b.facts.sort[index] === null
          return sorts[index]?.descending && !nullLast ? -order : order
        }
      }
      return a.at - b.at
    })
    const manySpaces =
      [view.groupBy, view.nib.subGroupBy].some((by) => by?.property === 'file.path') &&
      new Set(kept.map((one) => one.row.space)).size > 1
    const limit = view.limit && view.limit > 0 ? view.limit : null
    const cut = <T>(members: T[]): T[] => (limit === null ? members : members.slice(0, limit))

    const summaries = (members: readonly { row: Row; facts: RowFacts }[]) => {
      const out: Record<string, Value> = {}
      for (const [property, name] of Object.entries(view.summaries)) {
        const get = getter(property)
        const values = members.map((one) => {
          scope.row = one.row
          return settled(get.run(scope))
        })
        out[property] = summarize(name, values, base.summaries, context)
      }
      return out
    }

    const grouped = (
      members: { row: Row; facts: RowFacts }[],
      keyOf: (one: RowFacts) => Val,
      by: Sort | undefined,
      inner?: (members: { row: Row; facts: RowFacts }[]) => Group[],
      top = false,
    ): Group[] => {
      const cutGroup = (inGroup: { row: Row; facts: RowFacts }[], name: string) =>
        top ? cut(ordered(inGroup, name)) : inGroup
      if (!by) {
        const only = cutGroup(members, '')
        return [{ key: null, rows: only.map((one) => one.row), summaries: summaries(only) }]
      }
      const options = optionOrder(base, by.property)
      const spaced = by.property === 'file.path' && manySpaces
      const groups = new Map<string, { key: Value; members: { row: Row; facts: RowFacts }[] }>()
      for (const option of options) groups.set(option, { key: option, members: [] })
      const into = (key: Value, one: { row: Row; facts: RowFacts }) => {
        const name = groupName(key)
        const found = groups.get(name)
        if (found) {
          if (found.members.at(-1) !== one) found.members.push(one)
        } else groups.set(name, { key, members: [one] })
      }
      for (const one of members) {
        const said = settled(keyOf(one.facts))
        const key = spaced && typeof said === 'string' ? spacedPath(one.row.space, said) : said
        if (fanOut && Array.isArray(key)) {
          const each = key.filter((member) => member !== null && groupName(member) !== '')
          if (!each.length) into(null, one)
          for (const member of each) into(member, one)
        } else into(key, one)
      }
      const keys = [...groups.values()]
      const placed = view.nib.groups ?? []
      const rank = (key: Value): number => {
        const name = groupName(key)
        const own = placed.indexOf(name)
        if (own !== -1) return own
        const option = options.indexOf(name)
        return placed.length + (option === -1 ? options.length : option)
      }
      const noneFirst = view.nib.noneFirst === true
      if (view.nib.groupOrder !== 'rows')
        keys.sort((a, b) => {
          if (a.key === null || b.key === null)
            return a.key === b.key ? 0 : (a.key === null) !== noneFirst ? 1 : -1
          const byRank = rank(a.key) - rank(b.key)
          if (byRank !== 0) return byRank
          const order =
            by.property === 'file.path' && typeof a.key === 'string' && typeof b.key === 'string'
              ? byNoteName(a.key, b.key)
              : sortCompare(a.key, b.key)
          return by.direction === 'DESC' ? -order : order
        })
      return keys.map(({ key, members: inGroup }) => {
        const only = cutGroup(inGroup, groupName(key))
        const out: Group = {
          key,
          rows: only.map((one) => one.row),
          summaries: summaries(only),
        }
        if (inner) out.sub = inner(only)
        return out
      })
    }

    const ordered = <T extends { row: Row }>(members: T[], name: string): T[] => {
      const manual = view.nib.order?.[name]
      if (!manual?.length) return members
      const place = new Map(manual.map((id, at) => [id, at]))
      const rank = (one: T) =>
        place.get(orderId(one.row)) ?? place.get(rowId(one.row)) ?? manual.length
      return [...members].sort((a, b) => rank(a) - rank(b))
    }

    const subBy = view.nib.subGroupBy
    const groups = grouped(
      kept,
      (one) => one.group,
      view.groupBy,
      subBy ? (members) => grouped(members, (one) => one.sub, subBy) : undefined,
      true,
    )
    if (limit === null) return { groups, total: kept.length, summaries: summaries(kept) }
    const onScreen = new Set(groups.flatMap((group) => group.rows))
    const limited = kept.filter((one) => onScreen.has(one.row))
    return { groups, total: limited.length, summaries: summaries(limited) }
  }

  return { view, answer }
}

export function rowId(row: Row): string {
  return row.anchor ? `${row.path}#${row.anchor.line}` : row.path
}

export function orderId(row: Row): string {
  return row.anchor ? `${row.path}#^${row.anchor.hash}` : row.path
}

const compiledViews = new WeakMap<Base, Map<string | number, CompiledView>>()

export function answer(
  base: Base,
  view: string | number | undefined,
  rows: readonly Row[],
  context: Context,
): Answer {
  const { value, partial } = refusing(() =>
    underGuard(base.guarded, () => answerOf(base, view, rows, context)),
  )
  return partial ? { ...value, partial } : value
}

function answerOf(
  base: Base,
  view: string | number | undefined,
  rows: readonly Row[],
  context: Context,
): Answer {
  const views = compiledViews.get(base) ?? new Map<string | number, CompiledView>()
  compiledViews.set(base, views)
  const key = view ?? 0
  let compiled = views.get(key)
  if (!compiled) {
    compiled = compileView(base, view)
    views.set(key, compiled)
  }
  return compiled.answer(rows, context)
}

export function cellValue(base: Base, property: string, row: Row, context: Context): Value {
  const read = formulaReader(base.formulas)
  const scope: Scope = { row, context, locals: null, formula: (name, at) => read(name, at, scope) }
  return underGuard(base.guarded, () => settled(getter(property).run(scope)))
}
