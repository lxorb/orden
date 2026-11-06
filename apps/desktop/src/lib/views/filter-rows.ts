import type { Filter } from '@orden/bases'

export type Operator =
  '==' | '!=' | '<' | '>' | '<=' | '>=' | 'contains' | 'empty' | 'filled' | 'tag'
export const OPERATORS: readonly Operator[] = [
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  'contains',
  'empty',
  'filled',
  'tag',
]

export type FilterRow = { property: string; op: Operator; value: string } | { kept: Filter }

export interface FilterRows {
  join: 'and' | 'or'
  rows: FilterRow[]
}

export type Holds = 'truth' | 'number' | 'link' | 'other'
export type HoldsOf = (property: string) => Holds | undefined

const askedByNull = (holds: Holds | undefined) => holds === 'truth' || holds === 'link'

export const takesValue = (op: Operator): boolean => op !== 'empty' && op !== 'filled'

export function literal(value: string): string {
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  if (trimmed === 'true' || trimmed === 'false') return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `date(${JSON.stringify(trimmed)})`
  if (/^(today|now)\(\)(\s*[+-]\s*"[^"]*")?$/.test(trimmed)) return trimmed
  return JSON.stringify(value)
}

function unliteral(written: string): string | null {
  const trimmed = written.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || trimmed === 'true' || trimmed === 'false') return trimmed
  const dated = /^date\(("(?:[^"\\]|\\.)*")\)$/.exec(trimmed)
  if (dated?.[1]) return String(JSON.parse(dated[1]))
  if (/^(today|now)\(\)/.test(trimmed)) return trimmed
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return String(JSON.parse(trimmed))
  return null
}

export function expressionOf(
  row: { property: string; op: Operator; value: string },
  holds?: HoldsOf,
): string {
  const { property, op, value } = row
  switch (op) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return `${property} ${op} ${literal(value)}`
    case 'empty':
      return askedByNull(holds?.(property)) ? `${property} == null` : `${property}.isEmpty()`
    case 'filled':
      return askedByNull(holds?.(property)) ? `${property} != null` : `!${property}.isEmpty()`
    case 'contains':
      return `${property}.contains(${literal(value)})`
    case 'tag':
      return property.startsWith('task.')
        ? `task.hasTag(${JSON.stringify(value.replace(/^#/, ''))})`
        : `file.hasTag(${JSON.stringify(value.replace(/^#/, ''))})`
  }
}

export function rowOf(expression: string, holds?: HoldsOf): FilterRow {
  const text = expression.trim()

  const tag = /^(file|task)\.hasTag\(("(?:[^"\\]|\\.)*")\)$/.exec(text)
  if (tag?.[2]) {
    return { property: `${tag[1] ?? 'file'}.tags`, op: 'tag', value: String(JSON.parse(tag[2])) }
  }

  const contains = /^([A-Za-z_][\w.]*)\.contains\((.+)\)$/.exec(text)
  if (contains?.[1] && contains[2]) {
    const value = unliteral(contains[2])
    if (value !== null) return { property: contains[1], op: 'contains', value }
  }

  const nulled = /^([A-Za-z_][\w.]*)\s*(==|!=)\s*null$/.exec(text)
  if (nulled?.[1] && askedByNull(holds?.(nulled[1]))) {
    return { property: nulled[1], op: nulled[2] === '==' ? 'empty' : 'filled', value: '' }
  }

  const compared = /^([A-Za-z_][\w.]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(text)
  const op = OPERATORS.find((one) => one === compared?.[2])
  if (compared?.[1] && compared[3] && op) {
    const value = unliteral(compared[3])
    if (value !== null) return { property: compared[1], op, value }
  }

  const empty = /^(!?)([A-Za-z_][\w.]*)\.isEmpty\(\)$/.exec(text)
  if (empty?.[2]) return { property: empty[2], op: empty[1] ? 'filled' : 'empty', value: '' }

  const bare = /^(!?)([A-Za-z_][\w.]*)$/.exec(text)
  if (bare?.[2] && bare[2].includes('.') && holds?.(bare[2]) === 'other') {
    return { property: bare[2], op: bare[1] ? 'empty' : 'filled', value: '' }
  }
  return { kept: expression }
}

export function rowsOf(filter: Filter | undefined, holds?: HoldsOf): FilterRows {
  const memberRow = (member: Filter): FilterRow =>
    typeof member === 'string' ? rowOf(member, holds) : { kept: member }
  if (filter === undefined) return { join: 'and', rows: [] }
  if (typeof filter === 'string') return { join: 'and', rows: [rowOf(filter, holds)] }
  if ('and' in filter) return { join: 'and', rows: filter.and.map(memberRow) }
  if ('or' in filter) return { join: 'or', rows: filter.or.map(memberRow) }
  return { join: 'and', rows: [{ kept: filter }] }
}

export function filterOf(rows: FilterRows, holds?: HoldsOf): Filter | undefined {
  const members = rows.rows.map((row): Filter =>
    'kept' in row ? row.kept : expressionOf(row, holds),
  )
  if (!members.length) return undefined
  if (members.length === 1 && rows.join === 'and') return members[0]
  return rows.join === 'and' ? { and: members } : { or: members }
}
