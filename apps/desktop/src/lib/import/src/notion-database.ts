import { type Base, type PropertyConfig, writeBase } from '@orden/bases'
import { recordsOf } from './csv'
import type { Property } from './meta'
import { safeName, withoutNotionId } from './names'

export type Kind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'pages'

export interface Database {
  columns: string[]
  rows: Record<string, string>[]
  kinds: Map<string, Kind>
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

const CHECKBOX = /^(yes|no)$/i

const NOTION_DATE =
  /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2})(?: ?([AP]M))?)?(?: \(GMT[+-]\d{1,2}(?::\d{2})?\))?$/i

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const PAGE = / \(([^()\s]+\.md)\)(?:, |$)/g

const LABEL = /^[^.!?\n]{1,40}$/

export function databaseOf(text: string): Database {
  const { columns, rows } = recordsOf(text)
  const kinds = new Map<string, Kind>()
  for (const column of columns.slice(1)) {
    kinds.set(column, kindOf(rows.map((row) => row[column] ?? '')))
  }

  return { columns, rows, kinds }
}

export function kindOf(values: readonly string[]): Kind {
  const said = values.map((one) => one.trim()).filter(Boolean)
  if (!said.length) return 'text'

  if (said.every((one) => CHECKBOX.test(one))) return 'checkbox'
  if (said.every((one) => NUMBER.test(one))) return 'number'
  if (said.every((one) => notionDate(one) !== null || isRange(one))) return 'date'
  if (said.every((one) => pagesIn(one) !== null)) return 'pages'

  const labels = said.map((one) => one.split(',').map((label) => label.trim()))
  const listed =
    said.some((one) => one.includes(',')) &&
    labels.every((one) => one.every((label) => LABEL.test(label)))
  if (listed) {
    const seen = new Set<string>()
    for (const label of labels.flatMap((one) => [...new Set(one)])) {
      if (seen.has(label)) return 'list'
      seen.add(label)
    }
  }

  return 'text'
}

export function valueAs(kind: Kind, value: string): Property {
  switch (kind) {
    case 'checkbox':
      return CHECKBOX.test(value) ? /^yes$/i.test(value) : value
    case 'number':
      return NUMBER.test(value) ? Number(value) : value
    case 'date':
      return notionDate(value) ?? value
    case 'pages':
      return pagesIn(value)?.map((name) => `[[${name}]]`) ?? value
    case 'list':
      return value
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
    case 'text':
      return value
  }
}

export function notionDate(value: string): string | null {
  if (ISO_DATE.test(value)) return value

  const found = NOTION_DATE.exec(value)
  if (!found) return null

  const month = MONTHS.indexOf((found[1] ?? '').toLowerCase()) + 1
  const day = Number(found[2])
  const year = Number(found[3])
  if (!month || day < 1 || day > 31) return null

  const date = `${year}-${two(month)}-${two(day)}`
  if (found[4] === undefined) return date

  let hour = Number(found[4])
  const half = found[6]?.toUpperCase()
  if (half === 'PM' && hour < 12) hour += 12
  if (half === 'AM' && hour === 12) hour = 0
  if (hour > 23) return null

  return `${date}T${two(hour)}:${found[5] ?? '00'}`
}

function isRange(value: string): boolean {
  const [start = '', end = '', ...more] = value.split(' → ')
  return (
    !more.length &&
    notionDate(start) !== null &&
    (notionDate(end) !== null || /^\d{1,2}:\d{2}(?: ?[AP]M)?$/i.test(end))
  )
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

export function pagesIn(value: string): string[] | null {
  const names: string[] = []
  let at = 0

  for (const found of value.matchAll(PAGE)) {
    const title = value.slice(at, found.index)
    if (!title.trim()) return null
    names.push(nameOf(found[1] ?? ''))
    at = found.index + found[0].length
  }

  return names.length && at === value.length ? names : null
}

function nameOf(path: string): string {
  const last = path.split('/').pop() ?? path
  let name = last
  try {
    name = decodeURIComponent(last)
  } catch {
    // A stray percent sign is a character of the name.
  }
  return safeName(withoutNotionId(name).replace(/\.md$/i, ''))
}

export function baseBlock(database: Database, keyOf: (column: string) => string): string {
  const [title, ...rest] = database.columns
  const keys: string[] = []
  const properties: Record<string, PropertyConfig> = {}

  if (title && title !== 'Name') properties['file.name'] = { displayName: title, kept: {} }

  for (const column of rest) {
    const key = keyOf(column)
    if (!key || keys.includes(key)) continue
    keys.push(key)
    if (key !== column) properties[`note.${key}`] = { displayName: column, kept: {} }
  }

  const base: Base = {
    filters: { and: ['file.folder + ".md" == this.file.path'] },
    formulas: {},
    properties,
    summaries: {},
    views: [
      {
        type: 'table',
        name: 'Table',
        order: ['file.name', ...keys.map((one) => `note.${one}`)],
        sort: [],
        summaries: {},
        orden: { kept: {} },
        options: {},
      },
    ],
    orden: { properties: {}, kept: {} },
    kept: {},
  }

  return `\`\`\`base\n${writeBase(base).trimEnd()}\n\`\`\``
}
