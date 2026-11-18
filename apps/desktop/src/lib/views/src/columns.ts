import { deadlineField, startField } from '@orden/markdown/task-dates'
import {
  type Priority,
  readDuration,
  readTask,
  readTime,
  type TaskFields,
  WORD_BY_PRIORITY,
} from '@orden/markdown/task-line'
import {
  type Base,
  isButton,
  readButtons,
  readReverse,
  type Context,
  type Row,
  type RowKinds,
  type TaskChange,
  type TaskRow,
  type Value,
} from '@orden/bases'
import type { RowChange } from '../../rows/src/api'
import type { Holds, HoldsOf } from './filter-rows'
import { dayIn, isDurationValue, isLinkValue } from './values'

export type Editor =
  | 'text'
  | 'words'
  | 'number'
  | 'date'
  | 'time'
  | 'duration'
  | 'checkbox'
  | 'list'
  | 'priority'
  | 'status'
  | 'select'
  | 'button'
  | 'none'

export const bare = (property: string): string =>
  property.startsWith('note.') ? property.slice(5) : property

export function isNoteProperty(property: string): boolean {
  return !/^(file|formula|task|this)\./.test(property)
}

const TASK_EDITORS: Partial<Record<string, Editor>> = Object.fromEntries([
  ['text', 'words'],
  ['status', 'status'],
  ['done', 'checkbox'],
  ['due', 'date'],
  ['scheduled', 'date'],
  ['start', 'date'],
  ['deadline', 'date'],
  ['time', 'time'],
  ['duration', 'duration'],
  ['priority', 'priority'],
  ['tags', 'list'],
  ['assignee', 'text'],
] satisfies [string, Editor][])

function defaultColumns(kinds: RowKinds, rows: readonly Row[]): string[] {
  if (kinds === 'tasks') return ['task.text', 'file.basename', 'task.due', 'task.priority']

  const seen: string[] = []
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const key of Object.keys(row.note)) {
      if (!seen.includes(key)) seen.push(key)
      if (seen.length >= 5) break
    }
    if (seen.length >= 5) break
  }
  return ['file.name', ...seen.map((key) => `note.${key}`)]
}

export function columnsOf(base: Base, at: number, rows: readonly Row[]): string[] {
  const view = base.views[at]
  if (view?.order.length) return [...new Set(view.order)]
  return defaultColumns(view?.orden.rows ?? 'notes', rows)
}

export const displayName = (base: Base, property: string): string | undefined =>
  (base.properties[property] ?? base.properties[bare(property)])?.displayName

export const optionsOf = (base: Base, property: string): string[] =>
  base.orden.properties[bare(property)]?.options?.map((one) => one.value) ?? []

export const toneOf = (base: Base, property: string, value: string): string | undefined =>
  base.orden.properties[bare(property)]?.options?.find((one) => one.value === value)?.tone

function noteKind(key: string, rows: readonly Row[]): Editor {
  for (const row of rows) {
    const value = row.note[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') return 'checkbox'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'list'
    if (typeof value === 'object' && 'kind' in value && value.kind === 'date') return 'date'
    return 'text'
  }
  return 'text'
}

const TASK_OTHER = [
  'text',
  'status',
  'due',
  'scheduled',
  'start',
  'deadline',
  'time',
  'tags',
  'assignee',
  'section',
  'recurrence',
  'completed',
]
const FILE_OTHER = [
  'name',
  'basename',
  'path',
  'folder',
  'ext',
  'tags',
  'links',
  'embeds',
  'mtime',
  'ctime',
  'space',
]

const FIELD_HOLDS: Partial<Record<string, Holds>> = Object.fromEntries([
  ...TASK_OTHER.map((one): [string, Holds] => [`task.${one}`, 'other']),
  ['task.done', 'truth'],
  ['task.priority', 'number'],
  ['task.duration', 'number'],
  ...FILE_OTHER.map((one): [string, Holds] => [`file.${one}`, 'other']),
  ['file.size', 'number'],
] satisfies [string, Holds][])

function noteHolds(base: Base, key: string, rows: readonly Row[]): Holds | undefined {
  const format = base.orden.properties[key]?.format ?? ''
  if (/^(number|percent|progress|currency)/.test(format)) return 'number'
  let link = false
  let other = false
  for (const row of rows) {
    const value = row.note[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') return 'truth'
    if (typeof value === 'number') return 'number'
    if (isLinkValue(value)) link = true
    else if (typeof value === 'string' || Array.isArray(value)) other = true
    else if (typeof value === 'object' && 'kind' in value && value.kind === 'date') other = true
    else return undefined
  }
  if (!link && !other) return undefined
  return link && !other ? 'link' : 'other'
}

export function holdsOf(base: Base, rows: readonly Row[]): HoldsOf {
  const known = new Map<string, Holds | undefined>()
  return (property) => {
    if (known.has(property)) return known.get(property)
    const holds =
      property.startsWith('task.') || property.startsWith('file.')
        ? FIELD_HOLDS[property]
        : isNoteProperty(property)
          ? noteHolds(base, bare(property), rows)
          : undefined
    known.set(property, holds)
    return holds
  }
}

export const holdsLists = (property: string, rows: readonly Row[]): boolean =>
  noteKind(bare(property), rows) === 'list'

const readsAsNumber = (words: string) => words !== '' && String(Number(words)) === words

function holdsNumbers(base: Base, property: string, value: Value, rows: readonly Row[]): boolean {
  if (value !== null) return typeof value === 'number'
  const holds = holdsOf(base, rows)(property)
  if (holds !== undefined) return holds === 'number'
  const options = optionsOf(base, property)
  return options.length > 0 && options.every(readsAsNumber)
}

export const optionWritten = (
  base: Base,
  property: string,
  value: Value,
  rows: readonly Row[],
  words: string,
): Value =>
  readsAsNumber(words) && holdsNumbers(base, property, value, rows) ? Number(words) : words

export const keyWritten = (
  base: Base,
  property: string,
  key: Value,
  rows: readonly Row[],
): Value =>
  typeof key === 'string' && isNoteProperty(property)
    ? optionWritten(base, property, null, rows, key)
    : key

export function editorOf(base: Base, property: string, rows: readonly Row[]): Editor {
  if (property.startsWith('task.')) return TASK_EDITORS[property.slice(5)] ?? 'none'
  if (isButton(property)) return 'button'
  if (!isNoteProperty(property)) return 'none'
  if (base.orden.id?.property === bare(property)) return 'none'
  if (optionsOf(base, property).length) return 'select'
  return noteKind(bare(property), rows)
}

export function changeOf(row: Row, property: string, value: Value | null): RowChange | null {
  if (property.startsWith('task.')) {
    if (row.kind !== 'task' || !row.task) return null
    const field = property.slice(5)
    if (!(field in TASK_EDITORS)) return null
    const task = taskChange(row.task, field, value)
    return task ? { task } : null
  }
  if (!isNoteProperty(property)) return null
  return { note: { [bare(property)]: value } }
}

const PRIORITIES: readonly Priority[] = [1, 2, 3, 4, 5, 6]

const PRIORITY_BY_WORD = new Map<string, Priority>([
  ...PRIORITIES.map((priority): [string, Priority] => [String(priority), priority]),
  ...PRIORITIES.map((priority): [string, Priority] => [WORD_BY_PRIORITY[priority], priority]),
  ['normal', 4],
])

const STATUS_BY_NAME: Partial<Record<string, string>> = {
  'to do': ' ',
  todo: ' ',
  doing: '/',
  done: 'x',
  cancelled: '-',
}

function priorityOf(value: Value): Priority | undefined {
  const said =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  return PRIORITY_BY_WORD.get(said.toLowerCase().replace(/^p(?=\d$)/, ''))
}

function statusOf(value: Value): string | undefined {
  if (typeof value !== 'string') return undefined
  const named = STATUS_BY_NAME[value.trim().toLowerCase()]
  if (named !== undefined) return named
  return value.length === 1 && readTask(`- [${value}] task`)?.status === value ? value : undefined
}

function minutesOf(value: Value): number | undefined {
  if (typeof value === 'number') return value >= 0 ? Math.round(value) : undefined
  if (isDurationValue(value)) return Math.round(value.ms / 60_000)
  return typeof value === 'string' ? (readDuration(value) ?? undefined) : undefined
}

function statusChange(task: TaskFields, status: string): TaskChange | null {
  if (status === task.status) return null
  if (status.toLowerCase() === 'x') return task.done ? null : { done: true }
  if (status === ' ' && task.done) return { done: false }
  if (status === '-') return { cancelled: true, completed: null }
  return { status, completed: null, cancelledOn: null }
}

function dayChange(task: TaskRow, field: string, value: Value | null): TaskChange | null {
  const day = value === null ? null : dayIn(value)
  if (value !== null && day === null) return null
  const reads = task.dueReads
  const written =
    field === 'start'
      ? startField(task, reads)
      : field === 'deadline'
        ? deadlineField(task, reads)
        : field === 'scheduled'
          ? 'scheduled'
          : 'due'
  return { [written]: day }
}

function taskChange(task: TaskRow, field: string, value: Value | null): TaskChange | null {
  switch (field) {
    case 'status': {
      const status = statusOf(value)
      return status === undefined ? null : statusChange(task, status)
    }
    case 'done':
      return typeof value === 'boolean' ? { done: value } : null
    case 'due':
    case 'scheduled':
    case 'start':
    case 'deadline':
      return dayChange(task, field, value)
    case 'duration': {
      const duration = value === null ? null : minutesOf(value)
      return duration === undefined ? null : { duration }
    }
    case 'priority': {
      if (value === null) return { priority: null }
      const priority = priorityOf(value)
      return priority === undefined ? null : { priority }
    }
    case 'time': {
      if (value === null) return { time: null }
      const time = typeof value === 'string' ? readTime(value) : null
      return time ? { time: time.time, ...(time.zone ? { zone: time.zone } : {}) } : null
    }
    case 'tags':
      if (value === null) return { tags: [] }
      return Array.isArray(value)
        ? { tags: value.flatMap((one) => (typeof one === 'string' ? [one.replace(/^#/, '')] : [])) }
        : null
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? { text: value } : null
    case 'assignee':
      return value === null
        ? { assignee: null }
        : typeof value === 'string'
          ? { assignee: value }
          : null
    default:
      return null
  }
}

const TASK_FIELDS = [
  'task.text',
  'task.status',
  'task.due',
  'task.scheduled',
  'task.start',
  'task.deadline',
  'task.time',
  'task.duration',
  'task.priority',
  'task.tags',
  'task.assignee',
  'task.section',
  'task.recurrence',
  'task.completed',
]

const FILE_FIELDS = [
  'file.name',
  'file.basename',
  'file.folder',
  'file.tags',
  'file.mtime',
  'file.ctime',
  'file.size',
  'file.space',
]

export function knownProperties(base: Base, kinds: RowKinds, rows: readonly Row[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    if (kinds === 'tasks' && row.kind !== 'task') continue
    for (const key of Object.keys(row.note)) keys.add(`note.${key}`)
    if (keys.size > 200) break
  }
  return [
    ...(kinds === 'notes' ? [] : TASK_FIELDS),
    ...FILE_FIELDS,
    ...[...keys].sort(),
    ...Object.keys(base.formulas).map((name) => `formula.${name}`),
    ...readButtons(base).map((button) => `button.${button.name}`),
  ]
}

export function formatOf(base: Base, property: string): string | undefined {
  const key = property.startsWith('formula.') ? property.slice(8) : bare(property)
  return base.orden.properties[key]?.format
}

function holdsLink(value: Value | undefined): boolean {
  if (Array.isArray(value)) return value.some(holdsLink)
  return isLinkValue(value)
}

export function relationsOf(rows: readonly Row[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const [key, value] of Object.entries(row.note)) if (holdsLink(value)) keys.add(key)
  }
  return [...keys].sort().map((key) => `note.${key}`)
}

export interface ReverseOffer {
  property: string
  name: string
}

export function reverseOffers(
  base: Base,
  shown: readonly Row[],
  all: readonly Row[],
  context: Context,
): ReverseOffer[] {
  const keyOf = (space: string, path: string) => `${space}\n${path}`
  const here = new Set(shown.map((row) => keyOf(row.space, row.path)))
  const taken = new Set(Object.values(base.formulas).flatMap((source) => readReverse(source) ?? []))
  const found = new Map<string, string>()
  for (const row of all) {
    if (row.kind !== 'note') continue
    for (const [key, value] of Object.entries(row.note)) {
      if (found.has(key) || taken.has(key) || !holdsLink(value)) continue
      const targets = (Array.isArray(value) ? value : [value]).flatMap((one) =>
        isLinkValue(one) ? [one.target] : [],
      )
      const points = targets.some((target) => {
        const path = context.resolve?.(target, row)
        return path != null && here.has(keyOf(row.space, path))
      })
      if (points) found.set(key, row.file.folder.split('/').pop() ?? key)
    }
  }
  return [...found].map(([property, name]) => ({ property, name: name || property }))
}

export function parentOf(row: Row, context: Context): string | null {
  if (row.kind !== 'note') return null
  const said = row.note.parent
  const link = (Array.isArray(said) ? said[0] : said) ?? null
  if (!isLinkValue(link)) return null
  return context.resolve?.(link.target, row) ?? null
}
