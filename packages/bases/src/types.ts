import type { TaskFields } from '@orden/markdown/task-line'

export type { FieldName, Priority, Remind, TaskFields } from '@orden/markdown/task-line'
export type { TaskChange } from '@orden/markdown/task-edits'

export interface DateValue {
  kind: 'date'
  iso: string
  time?: string
  zone?: string
}

export interface DurationValue {
  kind: 'duration'
  ms: number
  months: number
}

export interface LinkValue {
  kind: 'link'
  target: string
  display?: string
}

export type RenderedValue =
  { kind: 'image'; src: string } | { kind: 'icon'; name: string } | { kind: 'html'; html: string }

export type Value =
  | null
  | boolean
  | number
  | string
  | DateValue
  | DurationValue
  | LinkValue
  | RenderedValue
  | Value[]
  | ValueRecord

export interface ValueRecord {
  [key: string]: Value
}

export interface FileInfo {
  name: string
  basename: string
  path: string
  folder: string
  ext: string
  size: number
  ctime: number
  mtime: number
  tags: string[]
  links: string[]
  embeds: string[]
  shared?: boolean
}

export interface TaskRow extends TaskFields {
  section: string[]
  parent?: number
  indent: number
  description?: string
  comments?: number
  dueReads?: 'deadline'
}

export interface Row {
  kind: 'note' | 'task'
  space: string
  path: string
  anchor?: { line: number; hash: string }
  file: FileInfo
  note: Record<string, Value>
  task?: TaskRow
}

export type Filter = string | { and: Filter[] } | { or: Filter[] } | { not: Filter[] }

export interface Sort {
  property: string
  direction: 'ASC' | 'DESC'
}

export interface PropertyConfig {
  displayName?: string
  kept: Record<string, unknown>
}

export interface SelectOption {
  value: string
  group?: 'todo' | 'doing' | 'done'
  tone?: string
}

export interface NibProperty {
  options?: SelectOption[]
  format?: string
  one?: boolean
  kept: Record<string, unknown>
}

export interface NibBase {
  template?: string
  id?: { property: string; prefix: string }
  properties: Record<string, NibProperty>
  locked?: boolean
  kept: Record<string, unknown>
}

export type CardSize = 'small' | 'medium' | 'large'

export type RowKinds = 'notes' | 'tasks' | 'both'

export interface NibView {
  rows?: RowKinds
  subGroupBy?: Sort
  order?: Record<string, string[]>
  date?: string
  end?: string
  colour?: string
  showCompleted?: boolean
  groupOrder?: 'value' | 'rows'
  hidden?: string[]
  locked?: boolean
  lines?: number
  freeze?: number
  template?: string
  required?: string[]
  cardSize?: CardSize
  groups?: string[]
  noneFirst?: boolean
  hideEmpty?: boolean
  colourColumns?: boolean
  kept: Record<string, unknown>
}

export interface View {
  type: string
  name: string
  filters?: Filter
  order: string[]
  sort: Sort[]
  groupBy?: Sort
  limit?: number
  summaries: Record<string, string>
  nib: NibView
  options: Record<string, unknown>
}

export interface Base {
  filters?: Filter
  formulas: Record<string, string>
  properties: Record<string, PropertyConfig>
  summaries: Record<string, string>
  views: View[]
  nib: NibBase
  kept: Record<string, unknown>
  guarded?: boolean
}

export interface Context {
  today: string
  now: string
  this?: Row
  resolve?: (target: string, from: Row) => string | null
  row?: (path: string, space: string) => Row | undefined
  backlinks?: (row: Row) => string[]
  me?: string
  search?: string
  random?: () => number
}

export interface Group {
  key: Value
  rows: Row[]
  summaries: Record<string, Value>
  sub?: Group[]
}

export interface Answer {
  groups: Group[]
  total: number
  summaries: Record<string, Value>
  partial?: boolean
}
