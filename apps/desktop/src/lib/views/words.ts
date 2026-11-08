import { addDays, groupName, isWhen, placeOfKey, type Value } from '@orden/bases'
import { i18n, key, t } from '../i18n.svelte'
import { dateAt } from './days'
import { bare } from './columns'
import { dayWords } from '@orden/editor/task-days'
import type { ChartKind, Measure } from './chart'
import type { Builtin } from './spec'
import { dayIn } from './values'

const BUILTIN_NAMES: Record<Builtin, string> = {
  todos: key('Tasks'),
  inbox: key('Inbox'),
  today: key('Today'),
  upcoming: key('Upcoming'),
  logbook: key('Completed'),
  project: key('Project'),
  label: key('Label'),
}

export const builtinName = (builtin: Builtin): string => t(BUILTIN_NAMES[builtin])

export const LAYOUTS = [
  'list',
  'table',
  'cards',
  'kanban',
  'calendar',
  'timeline',
  'chart',
  'form',
] as const
export type Layout = (typeof LAYOUTS)[number]

const LAYOUT_NAMES: Record<Layout, string> = {
  list: key('List'),
  table: key('Table'),
  cards: key('Cards'),
  kanban: key('Board'),
  calendar: key('Calendar'),
  timeline: key('Timeline'),
  chart: key('Chart'),
  form: key('Form'),
}

export function layoutOf(type: string): Layout {
  if (type === 'board') return 'kanban'
  return LAYOUTS.find((one) => one === type) ?? 'table'
}

export const layoutName = (layout: Layout): string => t(LAYOUT_NAMES[layout])

const STATUS_NAMES: Record<string, string> = {
  ' ': key('To do'),
  '/': key('Doing'),
  x: key('Done'),
  X: key('Done'),
  '-': key('Cancelled'),
}

const FIELD_NAMES: Record<string, string> = {
  'file.name': key('Name'),
  'file.basename': key('Note'),
  'file.path': key('Note'),
  'file.folder': key('Under'),
  'file.mtime': key('Modified'),
  'file.ctime': key('Created'),
  'file.size': key('Size'),
  'file.tags': key('Tags'),
  'file.space': key('Space'),
  'task.text': key('Task'),
  'task.status': key('Status'),
  'task.done': key('Done'),
  'task.due': key('Due'),
  'task.date': key('Start date'),
  'task.scheduled': key('Scheduled'),
  'task.start': key('Start'),
  'task.deadline': key('Deadline'),
  'task.time': key('Time'),
  'task.duration': key('Duration'),
  'task.priority': key('Priority'),
  'task.tags': key('Tags'),
  'task.assignee': key('Assignee'),
  'task.section': key('Section'),
  'task.recurrence': key('Repeat'),
  'task.completed': key('Done'),
}

export function propertyName(property: string, displayName?: string): string {
  if (displayName) return displayName
  const known = FIELD_NAMES[property]
  if (known) return t(known)
  return bare(property).replace(/^(formula|button)\./, '')
}

export const priorityName = (priority: number): string => `p${priority}`

export type NoteNames = ReadonlyMap<string, number>

const nameOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

export function noteNames(keys: readonly Value[]): NoteNames {
  const counts = new Map<string, number>()
  for (const key of keys) {
    if (typeof key !== 'string') continue
    const name = nameOf(key)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

export function groupLabel(
  property: string | undefined,
  value: Value,
  today: string,
  names?: NoteNames,
): string {
  if (property === 'formula.overdue') return value === true ? t('Overdue') : t('Today')
  if (value === 'overdue') return t('Overdue')
  if (isWhen(property)) {
    if (value === 'today') return t('Today')
    if (value === 'tomorrow') return t('Tomorrow')
    if (value === 'later') return t('Later')
    if (value === null || value === '') return t('No date')
  }
  if (value === null || value === '') return t('None')
  if (property === 'task.status' && typeof value === 'string') {
    const known = STATUS_NAMES[value]
    return known ? t(known) : value
  }
  if (property === 'task.priority' && typeof value === 'number') return priorityName(value)
  if (typeof value === 'boolean') return value ? '✓' : '–'
  if ((property === 'file.path' || property === 'file.basename') && typeof value === 'string')
    return noteLabel(value, names)
  const day = dayIn(value)
  if (day !== null && (typeof value !== 'string' || value.length === 10))
    return dayWords(day, today)
  return groupName(value)
}

function noteLabel(key: string, names: NoteNames | undefined): string {
  const { space, path } = placeOfKey(key)
  const name = nameOf(path)
  if ((names?.get(name) ?? 0) < 2) return name
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
  if (space === null) return `${name} (${folder ?? '/'})`
  return `${name} (${folder === null ? space : `${space}/${folder}`})`
}

export function dayHead(value: Value, today: string): string {
  const day = dayIn(value)
  if (day === null) return value === 'overdue' ? t('Overdue') : groupName(value)
  const date = i18n.when(dateAt(day), { weekday: 'short', day: 'numeric', month: 'short' })
  const near = dayWords(day, today)
  return day === today || day === addDays(today, 1) ? `${near}, ${date}` : date
}

export const statusName = (status: string): string => t(STATUS_NAMES[status] ?? 'To do')

const CHART_NAMES: Record<ChartKind, string> = {
  bar: key('Bars'),
  hbar: key('Bars across'),
  line: key('Line'),
  donut: key('Donut'),
  number: key('A number'),
}

export const chartName = (kind: ChartKind): string => t(CHART_NAMES[kind])

const MEASURE_NAMES: Record<Measure, string> = {
  count: key('Count'),
  sum: key('Sum'),
  average: key('Average'),
  earliest: key('Earliest'),
  latest: key('Latest'),
}

export const measureName = (measure: Measure): string => t(MEASURE_NAMES[measure])

const SUMMARY_NAMES: Record<string, string> = {
  Average: key('Average'),
  Min: key('Min'),
  Max: key('Max'),
  Sum: key('Sum'),
  Range: key('Range'),
  Median: key('Median'),
  Stddev: key('Stddev'),
  Earliest: key('Earliest'),
  Latest: key('Latest'),
  Checked: key('Ticked'),
  Unchecked: key('Not ticked'),
  Empty: key('Without a value'),
  Filled: key('With a value'),
  Unique: key('Unique'),
}

export const summaryName = (name: string): string => {
  const known = SUMMARY_NAMES[name]
  return known ? t(known) : name
}
