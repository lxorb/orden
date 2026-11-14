import { addDays, groupName, isWhen, placeOfKey, type Value } from '@orden/bases'
import { localDate } from '../../platform/src/api'
import { dateAt } from './days'
import { bare } from './columns'
import { dayWords } from '@orden/editor/task-days'
import type { ChartKind, Measure } from './chart'
import { dayIn } from './values'

export const LAYOUTS = ['table', 'cards', 'kanban', 'timeline', 'chart', 'form'] as const
export type Layout = (typeof LAYOUTS)[number]

const LAYOUT_NAMES: Record<Layout, string> = {
  table: 'Table',
  cards: 'Cards',
  kanban: 'Board',
  timeline: 'Timeline',
  chart: 'Chart',
  form: 'Form',
}

export function layoutOf(type: string): Layout {
  if (type === 'board') return 'kanban'
  return LAYOUTS.find((one) => one === type) ?? 'table'
}

export const layoutName = (layout: Layout): string => LAYOUT_NAMES[layout]

const STATUS_NAMES: Record<string, string> = {
  ' ': 'To do',
  '/': 'Doing',
  x: 'Done',
  X: 'Done',
  '-': 'Cancelled',
}

const FIELD_NAMES: Record<string, string> = {
  'file.name': 'Name',
  'file.basename': 'Note',
  'file.path': 'Note',
  'file.folder': 'Under',
  'file.mtime': 'Modified',
  'file.ctime': 'Created',
  'file.size': 'Size',
  'file.tags': 'Tags',
  'file.space': 'Space',
  'task.text': 'Task',
  'task.status': 'Status',
  'task.done': 'Done',
  'task.due': 'Due',
  'task.date': 'Start date',
  'task.scheduled': 'Scheduled',
  'task.start': 'Start',
  'task.deadline': 'Deadline',
  'task.time': 'Time',
  'task.duration': 'Duration',
  'task.priority': 'Priority',
  'task.tags': 'Tags',
  'task.assignee': 'Assignee',
  'task.section': 'Section',
  'task.recurrence': 'Repeat',
  'task.completed': 'Done',
}

export function propertyName(property: string, displayName?: string): string {
  if (displayName) return displayName
  const known = FIELD_NAMES[property]
  if (known) return known
  return bare(property).replace(/^(formula|button)\./, '')
}

const priorityName = (priority: number): string => `p${priority}`

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
  if (property === 'formula.overdue') return value === true ? 'Overdue' : 'Today'
  if (value === 'overdue') return 'Overdue'
  if (isWhen(property)) {
    if (value === 'today') return 'Today'
    if (value === 'tomorrow') return 'Tomorrow'
    if (value === 'later') return 'Later'
    if (value === null || value === '') return 'No date'
  }
  if (value === null || value === '') return 'None'
  if (property === 'task.status' && typeof value === 'string') {
    const known = STATUS_NAMES[value]
    return known ?? value
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
  if (day === null) return value === 'overdue' ? 'Overdue' : groupName(value)
  const date = localDate(dateAt(day), { weekday: 'short', day: 'numeric', month: 'short' })
  const near = dayWords(day, today)
  return day === today || day === addDays(today, 1) ? `${near}, ${date}` : date
}

const CHART_NAMES: Record<ChartKind, string> = {
  bar: 'Bars',
  hbar: 'Bars across',
  line: 'Line',
  donut: 'Donut',
  number: 'A number',
}

export const chartName = (kind: ChartKind): string => CHART_NAMES[kind]

const MEASURE_NAMES: Record<Measure, string> = {
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  earliest: 'Earliest',
  latest: 'Latest',
}

export const measureName = (measure: Measure): string => MEASURE_NAMES[measure]

const SUMMARY_NAMES: Record<string, string> = {
  Average: 'Average',
  Min: 'Min',
  Max: 'Max',
  Sum: 'Sum',
  Range: 'Range',
  Median: 'Median',
  Stddev: 'Stddev',
  Earliest: 'Earliest',
  Latest: 'Latest',
  Checked: 'Ticked',
  Unchecked: 'Not ticked',
  Empty: 'Without a value',
  Filled: 'With a value',
  Unique: 'Unique',
}

export const summaryName = (name: string): string => {
  const known = SUMMARY_NAMES[name]
  return known ?? name
}
