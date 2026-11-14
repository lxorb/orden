import { deadlineField, startField } from '@orden/markdown/task-dates'
import {
  type Base,
  isButton,
  readButtons,
  readReverse,
  type Context,
  type Row,
  type RowKinds,
  type TaskChange,
  type Value,
} from '@orden/bases'
import type { RowChange } from '../../rows/src/api'
import type { Holds, HoldsOf } from './filter-rows'
import { isLinkValue } from './values'

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

export function bare(property: string): string {
  return property.startsWith('note.') ? property.slice(5) : property
}

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

export function displayName(base: Base, property: string): string | undefined {
  return (base.properties[property] ?? base.properties[bare(property)])?.displayName
}

export function optionsOf(base: Base, property: string): string[] {
  return base.orden.properties[bare(property)]?.options?.map((one) => one.value) ?? []
}

export function toneOf(base: Base, property: string, value: string): string | undefined {
  return base.orden.properties[bare(property)]?.options?.find((one) => one.value === value)?.tone
}

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

export function holdsLists(property: string, rows: readonly Row[]): boolean {
  return noteKind(bare(property), rows) === 'list'
}

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
    if (row.kind !== 'task') return null
    const field = property.slice(5)
    if (!(field in TASK_EDITORS)) return null
    const reads = row.task?.dueReads
    const written =
      field === 'start' && row.task
        ? startField(row.task, reads)
        : field === 'deadline' && row.task
          ? deadlineField(row.task, reads)
          : field
    const task: TaskChange = { [written]: value }
    return { task }
  }
  if (!isNoteProperty(property)) return null
  return { note: { [bare(property)]: value } }
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
