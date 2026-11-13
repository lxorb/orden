import type { Base, Filter, View } from './types'

export type BuiltinName =
  'todos' | 'inbox' | 'today' | 'upcoming' | 'logbook' | 'label' | 'assigned'

export interface BuiltinParams {
  inboxes?: { space: string; path: string }[]
  tag?: string
  space?: string
  undated?: boolean
}

const TODAY = 'task.date <= today() || task.deadline <= today()'
const UNDATED = '!task.start && !task.scheduled'

const quote = (text: string) => JSON.stringify(text)

const BY_DEADLINE =
  'if(task.deadline < today(), "overdue", if(task.deadline == today(), "today", if(task.deadline == today() + "1d", "tomorrow", "later")))'

export const WHEN = `if(!task.deadline, null, ${BY_DEADLINE})`
const WHEN_UNDATED = `if(!task.deadline, if(${UNDATED}, "today", null), ${BY_DEADLINE})`

const whenFormula = (undated: boolean) => (undated ? WHEN_UNDATED : WHEN)
export const isWhenFormula = (text: string | undefined) => text === WHEN || text === WHEN_UNDATED

export const WHEN_ASIDE = 'ordenWhen'
export function isWhen(property: string | undefined): boolean {
  return property === 'formula.when' || property === `formula.${WHEN_ASIDE}`
}

export const WHEN_GROUPS = ['overdue', 'today', 'tomorrow', 'later']

export const SMART_SORT: View['sort'] = [
  { property: 'task.priority', direction: 'ASC' },
  { property: 'task.deadline', direction: 'ASC' },
  { property: 'task.time', direction: 'ASC' },
]

const inNote = (space: string, path: string) =>
  `file.space == ${quote(space)} && file.path == ${quote(path)}`

function base(
  view: Omit<View, 'orden' | 'options' | 'order' | 'summaries'> & Partial<View>,
  formulas: Record<string, string> = {},
): Base {
  return {
    formulas,
    properties: {},
    summaries: {},
    views: [{ order: [], summaries: {}, options: {}, orden: { rows: 'tasks', kept: {} }, ...view }],
    orden: { properties: {}, kept: {} },
    kept: {},
  }
}

export function builtinView(name: BuiltinName, params: BuiltinParams = {}): Base {
  switch (name) {
    case 'todos':
      return base(
        {
          type: 'list',
          name: 'Todos',
          filters:
            params.space === undefined
              ? 'task.started'
              : { and: ['task.started', `file.space == ${quote(params.space)}`] },
          sort: SMART_SORT,
          groupBy: { property: 'formula.when', direction: 'ASC' },
          orden: { rows: 'tasks', groups: [...WHEN_GROUPS], kept: {} },
        },
        { when: whenFormula(params.undated === true) },
      )
    case 'inbox': {
      const inboxes = params.inboxes ?? []
      const filters: Filter = inboxes.length
        ? { and: ['task.started', { or: inboxes.map((one) => inNote(one.space, one.path)) }] }
        : 'false'
      return base({
        type: 'list',
        name: 'Inbox',
        filters,
        sort: [],
        groupBy: { property: 'file.space', direction: 'ASC' },
      })
    }
    case 'today':
      return base(
        {
          type: 'list',
          name: 'Today',
          filters: {
            and: ['task.started', params.undated ? `${UNDATED} || ${TODAY}` : TODAY],
          },
          sort: [
            { property: 'task.priority', direction: 'ASC' },
            { property: 'task.time', direction: 'ASC' },
          ],
          groupBy: { property: 'formula.overdue', direction: 'DESC' },
        },
        { overdue: 'task.deadline < today()' },
      )
    case 'upcoming':
      return base(
        {
          type: 'list',
          name: 'Upcoming',
          filters: 'task.date',
          sort: [
            { property: 'task.date', direction: 'ASC' },
            { property: 'task.time', direction: 'ASC' },
            { property: 'task.priority', direction: 'ASC' },
          ],
          groupBy: { property: 'formula.day', direction: 'ASC' },
          orden: { rows: 'tasks', groups: ['overdue'], kept: {} },
        },
        {
          day: 'if(task.deadline < today(), "overdue", if(task.date < today(), today(), task.date))',
        },
      )
    case 'logbook':
      return base(
        {
          type: 'list',
          name: 'Completed',
          filters: 'task.done || task.cancelled',
          sort: [],
          groupBy: { property: 'formula.day', direction: 'DESC' },
          orden: { rows: 'tasks', showCompleted: true, kept: {} },
        },
        { day: 'if(task.completed, task.completed, task.cancelledOn)' },
      )
    case 'label': {
      const tag = quote(params.tag ?? '')
      const tagged = `if(task, task.started && task.hasTag(${tag}), file.hasTag(${tag}))`
      return base({
        type: 'list',
        name: `#${params.tag ?? ''}`,
        filters:
          params.space === undefined
            ? tagged
            : { and: [`file.space == ${quote(params.space)}`, tagged] },
        sort: [],
        groupBy: { property: 'file.path', direction: 'ASC' },
        orden: { rows: 'both', kept: {} },
      })
    }
    case 'assigned':
      return base({
        type: 'list',
        name: 'Assigned to me',
        filters: 'task.mine && task.started',
        sort: [
          { property: 'task.date', direction: 'ASC' },
          { property: 'task.priority', direction: 'ASC' },
        ],
      })
  }
}

function swapped(filter: Filter, from: string, to: string): Filter {
  if (typeof filter === 'string') return filter === from ? to : filter
  if ('and' in filter) return { and: filter.and.map((one) => swapped(one, from, to)) }
  if ('or' in filter) return { or: filter.or.map((one) => swapped(one, from, to)) }
  return { not: filter.not.map((one) => swapped(one, from, to)) }
}

export function todayAs(base: Base, undated: boolean): Base {
  const now = undated ? `${UNDATED} || ${TODAY}` : TODAY
  const other = undated ? TODAY : `${UNDATED} || ${TODAY}`
  return {
    ...base,
    views: base.views.map((view) =>
      view.filters ? { ...view, filters: swapped(view.filters, other, now) } : view,
    ),
  }
}

export function whenAs(base: Base, undated: boolean): Base {
  const formulas = { ...base.formulas }
  for (const name of ['when', WHEN_ASIDE]) {
    if (isWhenFormula(formulas[name])) formulas[name] = whenFormula(undated)
  }
  return { ...base, formulas }
}
