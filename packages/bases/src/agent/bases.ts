import { isPropertyName } from '@orden/markdown/front-matter'
import { type ListItem, writeList, writeProperty } from '@orden/markdown/property-edits'
import { readFilter } from '../filter'
import type { Base, Filter, Sort, View } from '../types'
import { AgentError } from './tasks'

type Args = Record<string, unknown>

const isRecord = (value: unknown): value is Args =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function keyOf(name: string): string | null {
  const key = name.startsWith('note.') ? name.slice(5) : name
  if (/^(?:file|formula)\./.test(key) || !isPropertyName(key)) return null
  return key
}

export function withProperties(text: string, properties: Args): string {
  let after = text
  for (const [name, value] of Object.entries(properties)) {
    const key = keyOf(name)
    if (key === null) throw new AgentError('bad_arguments', `${name} is not a property name`)
    const edit = Array.isArray(value)
      ? writeList(after, key, value.map(listItem))
      : value === null
        ? writeProperty(after, key, null)
        : typeof value === 'boolean'
          ? writeProperty(after, key, String(value), 'checkbox')
          : typeof value === 'number'
            ? writeProperty(after, key, String(value), 'number')
            : typeof value === 'string'
              ? writeProperty(after, key, value)
              : undefined
    if (edit === undefined)
      throw new AgentError(
        'bad_arguments',
        `${key} is words, a number, true or false, a list, or null`,
      )
    if (edit) after = after.slice(0, edit.from) + edit.insert + after.slice(edit.to)
  }
  return after
}

function listItem(value: unknown): ListItem {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function required(filter: Filter | undefined): string[] {
  if (filter === undefined) return []
  if (typeof filter === 'string') return [filter]
  return 'and' in filter ? filter.and.flatMap(required) : []
}

const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'`
const IN_FOLDER = new RegExp(String.raw`^\s*file\.inFolder\(\s*(?:${QUOTED})\s*\)\s*$`)
const FOLDER_IS = new RegExp(String.raw`^\s*file\.folder\s*==\s*(?:${QUOTED})\s*$`)
const HAS_TAG = new RegExp(String.raw`^\s*file\.hasTag\(\s*(?:${QUOTED})\s*\)\s*$`)
const EQUALS = new RegExp(
  String.raw`^\s*(?:note\.)?([A-Za-z_][\w-]*)\s*==\s*(?:${QUOTED}|(true|false|-?\d+(?:\.\d+)?))\s*$`,
)

export function rowPlace(base: Base, view?: string): { folder?: string; properties: Args } {
  const chosen = view === undefined ? base.views[0] : base.views.find((one) => one.name === view)
  const properties: Args = {}
  const tags: string[] = []
  let folder: string | undefined

  for (const expression of [...required(base.filters), ...required(chosen?.filters)]) {
    const inFolder = IN_FOLDER.exec(expression) ?? FOLDER_IS.exec(expression)
    if (inFolder) {
      folder = (inFolder[1] ?? inFolder[2] ?? '').replace(/^\/+|\/+$/g, '')
      continue
    }
    const tag = HAS_TAG.exec(expression)
    if (tag) {
      tags.push((tag[1] ?? tag[2] ?? '').replace(/^#/, ''))
      continue
    }
    const equal = EQUALS.exec(expression)
    if (equal?.[1] && !equal[1].startsWith('file') && !equal[1].startsWith('task')) {
      const literal = equal[4]
      properties[equal[1]] =
        literal === undefined
          ? (equal[2] ?? equal[3] ?? '')
          : literal === 'true' || literal === 'false'
            ? literal === 'true'
            : Number(literal)
    }
  }
  if (tags.length) properties.tags = tags
  return { ...(folder === undefined ? {} : { folder }), properties }
}

export function noteName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return name.replace(/\.+$/, '') || 'Untitled'
}

function words(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new AgentError('bad_arguments', `say ${name}`)
  return value.trim()
}

function sortsOf(value: unknown): Sort[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.map((one) => {
    if (typeof one === 'string') return { property: one, direction: 'ASC' }
    if (!isRecord(one) || typeof one.property !== 'string') {
      throw new AgentError('bad_arguments', 'a sort is {property, direction: ASC or DESC}')
    }
    return {
      property: one.property,
      direction: String(one.direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
    }
  })
}

function filterOf(value: unknown): Filter {
  const filter = readFilter(value)
  if (filter === null)
    throw new AgentError('bad_arguments', 'a filter is an expression, or {and|or|not: [filters]}')
  return filter
}

function viewWith(view: View, said: Args): View {
  const next: View = { ...view, orden: { ...view.orden }, options: { ...view.options } }
  if (said.type !== undefined) next.type = words(said.type, 'type')
  if (said.name !== undefined) next.name = words(said.name, 'name')
  if (said.filters !== undefined) {
    delete next.options.filters
    if (said.filters === null) delete next.filters
    else next.filters = filterOf(said.filters)
  }
  if (said.order !== undefined) {
    if (!Array.isArray(said.order) || !said.order.every((one) => typeof one === 'string')) {
      throw new AgentError('bad_arguments', 'order is a list of properties')
    }
    next.order = said.order
  }
  if (said.sort !== undefined) next.sort = sortsOf(said.sort)
  if (said.groupBy !== undefined) {
    if (said.groupBy === null) delete next.groupBy
    else {
      const [group] = sortsOf(said.groupBy)
      if (group) next.groupBy = group
    }
  }
  if (said.limit !== undefined) {
    delete next.options.limit
    if (said.limit === null) delete next.limit
    else if (typeof said.limit === 'number' && said.limit > 0) next.limit = Math.floor(said.limit)
    else throw new AgentError('bad_arguments', 'limit is a number')
  }
  if (said.rows !== undefined) {
    if (said.rows !== 'notes' && said.rows !== 'tasks' && said.rows !== 'both') {
      throw new AgentError('bad_arguments', 'rows is notes, tasks or both')
    }
    next.orden.rows = said.rows
  }
  return next
}

function named(base: Base, said: Args): number {
  if (said.view === undefined && said.name === undefined) return 0
  const name = typeof said.view === 'string' ? said.view : said.name
  const at = base.views.findIndex((one) => one.name === name)
  if (at === -1) throw new AgentError('not_found', `there is no view called ${String(name)}`)
  return at
}

const MOST_OPS = 500

export function editedBase(base: Base, ops: unknown): Base {
  if (!Array.isArray(ops) || !ops.length)
    throw new AgentError('bad_arguments', 'ops is a list of edits')
  if (ops.length > MOST_OPS) throw new AgentError('bad_arguments', `at most ${MOST_OPS} ops a call`)
  let next: Base = {
    ...base,
    views: [...base.views],
    formulas: { ...base.formulas },
    properties: { ...base.properties },
  }

  for (const raw of ops) {
    if (!isRecord(raw)) throw new AgentError('bad_arguments', 'an op is an object with op')
    switch (raw.op) {
      case 'add_view': {
        const blank: View = {
          type: 'table',
          name: '',
          order: [],
          sort: [],
          summaries: {},
          orden: { kept: {} },
          options: {},
        }
        const view = viewWith(blank, raw)
        if (!view.name) throw new AgentError('bad_arguments', "say the new view's name")
        if (next.views.some((one) => one.name === view.name)) {
          throw new AgentError('bad_arguments', `there is a view called ${view.name} already`)
        }
        next.views.push(view)
        break
      }
      case 'edit_view': {
        const at = named(next, { view: raw.view ?? raw.name })
        const view = next.views[at]
        if (view)
          next.views[at] = viewWith(view, {
            ...raw,
            name: raw.view === undefined ? undefined : raw.name,
          })
        break
      }
      case 'remove_view': {
        const at = named(next, raw)
        next.views.splice(at, 1)
        break
      }
      case 'set_filter': {
        if (raw.view === undefined) {
          next = { ...next, kept: { ...next.kept } }
          delete next.kept.filters
          if (raw.filter === null) delete next.filters
          else next.filters = filterOf(raw.filter)
        } else {
          const at = named(next, raw)
          const view = next.views[at]
          if (view) next.views[at] = viewWith(view, { filters: raw.filter })
        }
        break
      }
      case 'add_formula':
        next.formulas[words(raw.name, 'name')] = words(raw.formula, 'formula')
        break
      case 'add_property': {
        const name = words(raw.name, 'name')
        const displayName = typeof raw.displayName === 'string' ? raw.displayName : undefined
        next.properties[name] = {
          ...(next.properties[name] ?? { kept: {} }),
          ...(displayName ? { displayName } : {}),
        }
        break
      }
      default:
        throw new AgentError(
          'bad_arguments',
          'op is add_view, edit_view, remove_view, set_filter, add_formula or add_property',
        )
    }
  }
  return next
}
