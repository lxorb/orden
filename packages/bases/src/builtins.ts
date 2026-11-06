import type { Base, Filter, View } from './types'

export type BuiltinName =
  'todos' | 'inbox' | 'today' | 'upcoming' | 'logbook' | 'project' | 'label' | 'assigned'

export interface BuiltinParams {
  inboxes?: { space: string; path: string }[]
  note?: { space: string; path: string }
  tag?: string
  space?: string
  undated?: boolean
}

const TODAY = 'task.date <= today() || task.deadline <= today()'
const UNDATED = '!task.start && !task.scheduled'

const quote = (text: string) => JSON.stringify(text)

export const WHEN =
  'if(!task.deadline, null, if(task.deadline < today(), "overdue", if(task.deadline == today(), "today", if(task.deadline == today() + "1d", "tomorrow", "later"))))'

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
  view: Omit<View, 'nib' | 'options' | 'order' | 'summaries'> & Partial<View>,
  formulas: Record<string, string> = {},
): Base {
  return {
    formulas,
    properties: {},
    summaries: {},
    views: [{ order: [], summaries: {}, options: {}, nib: { rows: 'tasks', kept: {} }, ...view }],
    nib: { properties: {}, kept: {} },
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
          nib: { rows: 'tasks', groups: [...WHEN_GROUPS], kept: {} },
        },
        { when: WHEN },
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
          nib: { rows: 'tasks', groups: ['overdue'], kept: {} },
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
          nib: { rows: 'tasks', showCompleted: true, kept: {} },
        },
        { day: 'if(task.completed, task.completed, task.cancelledOn)' },
      )
    case 'project': {
      const note = params.note
      return base({
        type: 'list',
        name: note ? note.path.replace(/^.*\//, '').replace(/\.md$/i, '') : 'Project',
        filters: note ? inNote(note.space, note.path) : 'false',
        sort: [],
        groupBy: { property: 'task.section', direction: 'ASC' },
        nib: { rows: 'tasks', groupOrder: 'rows', kept: {} },
      })
    }
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
        nib: { rows: 'both', kept: {} },
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

export function todayAs(base: Base, undated: boolean): Base {
  const now = builtinView('today', { undated }).views[0]?.filters
  const other = JSON.stringify(builtinView('today', { undated: !undated }).views[0]?.filters)
  if (now === undefined) return base
  return {
    ...base,
    views: base.views.map((view) =>
      JSON.stringify(view.filters) === other ? { ...view, filters: now } : view,
    ),
  }
}
