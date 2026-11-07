import { answer, cellValue, groupName } from '../answer'
import { type BuiltinName, builtinView } from '../builtins'
import { BasesError } from '../errors'
import { type TodoistOptions, fromTodoist } from '../todoist'
import type { Answer, Base, Context, Filter, Row, Value } from '../types'
import { AgentError, type TaskOut, taskOut } from './tasks'

export const VIEWS = ['todos', 'inbox', 'today', 'upcoming', 'logbook'] as const

function everything(filters?: Filter): Base {
  return {
    formulas: {},
    properties: {},
    summaries: {},
    views: [
      {
        type: 'list',
        name: '',
        ...(filters === undefined ? {} : { filters }),
        order: [],
        sort: [{ property: 'task.date', direction: 'ASC' }],
        summaries: {},
        orden: { rows: 'tasks', kept: {} },
        options: {},
      },
    ],
    orden: { properties: {}, kept: {} },
    kept: {},
  }
}

function narrowed(base: Base, filter: Filter): Base {
  const [view, ...rest] = base.views
  if (!view) return everything(filter)
  return {
    ...base,
    views: [
      { ...view, filters: view.filters === undefined ? filter : { and: [view.filters, filter] } },
      ...rest,
    ],
  }
}

export interface ListAsk {
  view?: string
  filter?: string
  base?: { base: Base; view?: string }
  limit?: number
  inboxes?: { space: string; path: string }[]
  undated?: boolean
  isNote?: TodoistOptions['isNote']
}

export function listTasks(
  rows: readonly Row[],
  ask: ListAsk,
  context: Context,
): { total: number; tasks: TaskOut[] } {
  let base: Base
  let view: string | undefined
  if (ask.base) {
    base = ask.base.base
    view = ask.base.view
  } else if (ask.view) {
    const name = ask.view.trim().toLowerCase()
    if (!(VIEWS as readonly string[]).includes(name)) {
      throw new AgentError('bad_arguments', `view is ${VIEWS.join(', ')} or a .base path`)
    }
    base = builtinView(name as BuiltinName, {
      inboxes: ask.inboxes ?? [],
      ...(ask.undated ? { undated: true } : {}),
    })
  } else {
    base = everything()
  }

  let lists: Filter[] = []
  if (ask.filter?.trim()) {
    try {
      lists = fromTodoist(ask.filter, { ...(ask.isNote ? { isNote: ask.isNote } : {}) })
    } catch (error) {
      throw new AgentError(
        'bad_arguments',
        `filter: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const seen = new Set<Row>()
  const out: Row[] = []
  for (const one of lists.length ? lists.map((filter) => narrowed(base, filter)) : [base]) {
    for (const group of answered(one, view, rows, context).groups) {
      for (const row of group.rows) {
        if (row.kind !== 'task' || seen.has(row)) continue
        seen.add(row)
        out.push(row)
      }
    }
  }
  const limit = Math.min(Math.max(0, Math.floor(ask.limit ?? 50)), 500)
  return { total: out.length, tasks: out.slice(0, limit).map(taskOut) }
}

function answered(
  base: Base,
  view: string | undefined,
  rows: readonly Row[],
  context: Context,
): Answer {
  try {
    return answer(base, view, rows, context)
  } catch (error) {
    if (error instanceof BasesError) throw new AgentError('bad_arguments', error.message)
    throw error
  }
}

export function plainValue(value: Value): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(plainValue)
  if ('kind' in value) {
    if (value.kind === 'date' && typeof value.iso === 'string') {
      return typeof value.time === 'string' ? `${value.iso} ${value.time}` : value.iso
    }
    if (value.kind === 'link' && typeof value.target === 'string') return value.target
    if (value.kind === 'duration' && typeof value.ms === 'number')
      return `${Math.round(value.ms / 60_000)}m`
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, one]) => [key, plainValue(one as Value)]),
  )
}

interface NoteOut {
  path: string
  space: string
  [column: string]: unknown
}

export interface QueryOut {
  total: number
  groups: { key: string; rows: (TaskOut | NoteOut)[]; summaries?: Record<string, unknown> }[]
  summaries?: Record<string, unknown>
}

export function queryBase(
  base: Base,
  view: string | undefined,
  rows: readonly Row[],
  context: Context,
  limit = 200,
): QueryOut {
  const answer = answered(base, view, rows, context)
  const chosen =
    view === undefined
      ? base.views[0]
      : (base.views.find((one) => one.name === view) ?? base.views[0])
  const columns = chosen?.order ?? []
  let left = Math.min(Math.max(1, Math.floor(limit)), 1000)

  const rowOut = (row: Row): TaskOut | NoteOut => {
    if (row.kind === 'task') return taskOut(row)
    const values: Record<string, unknown> = {}
    if (columns.length) {
      for (const column of columns)
        values[column] = plainValue(cellValue(base, column, row, context))
    } else {
      for (const [key, value] of Object.entries(row.note)) values[key] = plainValue(value)
    }
    return { path: row.path, space: row.space, ...values }
  }
  const summed = (summaries: Record<string, Value>) =>
    Object.keys(summaries).length
      ? Object.fromEntries(Object.entries(summaries).map(([key, one]) => [key, plainValue(one)]))
      : undefined

  const groups = answer.groups.map((group) => {
    const taken = group.rows.slice(0, Math.max(0, left))
    left -= taken.length
    const summaries = summed(group.summaries)
    return {
      key: groupName(group.key),
      rows: taken.map(rowOut),
      ...(summaries ? { summaries } : {}),
    }
  })
  const summaries = summed(answer.summaries)
  return { total: answer.total, groups, ...(summaries ? { summaries } : {}) }
}
