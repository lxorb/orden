/** A view's filter as rows to click, and the rows back into Bases' filter: Notion's
 *  filter builder over Obsidian's YAML (docs/tasks.md 4, "filter builder without
 *  typing").
 *
 *  A row is a property, an operator and a value, and becomes one expression. The rows
 *  are joined by the view's `and` or `or`; whatever the builder cannot show as a row
 *  (a formula somebody wrote, a group inside a group) is kept as it was written and
 *  shown as its words, so opening the builder never loses a filter. Pure. */

import type { Filter } from '@nib/bases'

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

export type FilterRow =
  | { property: string; op: Operator; value: string }
  /** An expression or a group the builder keeps as written. */
  | { kept: Filter }

export interface FilterRows {
  join: 'and' | 'or'
  rows: FilterRow[]
}

/** What a property holds, as far as asking it whether it is empty goes: `truth` a
 *  checkbox, `number` a number, `link` one link, `other` a text, a date or a list.
 *  Undefined where it is not known (a formula, a task's field nib does not list). */
export type Holds = 'truth' | 'number' | 'link' | 'other'
export type HoldsOf = (property: string) => Holds | undefined

/** Whether `== null` asks a property whether it is empty: Obsidian documents
 *  `isEmpty()` for a text, a number, a date, a list and an object, not for a checkbox
 *  or a link, and `null` reads the same in both. */
const askedByNull = (holds: Holds | undefined) => holds === 'truth' || holds === 'link'

/** Whether an operator takes a value. */
export const takesValue = (op: Operator): boolean => op !== 'empty' && op !== 'filled'

/** A value as the literal an expression writes: a number as itself, `true` and
 *  `false`, a day as `date("…")`, a call (`today()`) as itself, and words quoted. */
export function literal(value: string): string {
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  if (trimmed === 'true' || trimmed === 'false') return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `date(${JSON.stringify(trimmed)})`
  if (/^(today|now)\(\)(\s*[+-]\s*"[^"]*")?$/.test(trimmed)) return trimmed
  return JSON.stringify(value)
}

/** A literal read back into what the field shows. */
function unliteral(written: string): string | null {
  const trimmed = written.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || trimmed === 'true' || trimmed === 'false') return trimmed
  const dated = /^date\(("(?:[^"\\]|\\.)*")\)$/.exec(trimmed)
  if (dated?.[1]) return String(JSON.parse(dated[1]))
  if (/^(today|now)\(\)/.test(trimmed)) return trimmed
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return String(JSON.parse(trimmed))
  return null
}

/** One row as the expression it stands for. */
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
    // `isEmpty()`, as Obsidian writes it: 0 and false are values, only a missing
    // property, an empty text or an empty list is empty.
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

/** One expression as a row, where the builder can show it as one. `holds` says what
 *  each property holds, for the rows an older builder wrote as `!prop` and `prop`. */
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

  // The builder once wrote "is empty" as `!prop` and "is not empty" as `prop`, which
  // ask whether it is true. For a text, a date or a list that is whether it is empty,
  // so the row is read and saved again the new way; a number's 0 and a checkbox's
  // false are not true but are there, so there it is kept as written.
  const bare = /^(!?)([A-Za-z_][\w.]*)$/.exec(text)
  if (bare?.[2] && bare[2].includes('.') && holds?.(bare[2]) === 'other') {
    return { property: bare[2], op: bare[1] ? 'empty' : 'filled', value: '' }
  }
  return { kept: expression }
}

/** A view's filter as rows: its top level's `and` or `or`, one row per member. */
export function rowsOf(filter: Filter | undefined, holds?: HoldsOf): FilterRows {
  const memberRow = (member: Filter): FilterRow =>
    typeof member === 'string' ? rowOf(member, holds) : { kept: member }
  if (filter === undefined) return { join: 'and', rows: [] }
  if (typeof filter === 'string') return { join: 'and', rows: [rowOf(filter, holds)] }
  if ('and' in filter) return { join: 'and', rows: filter.and.map(memberRow) }
  if ('or' in filter) return { join: 'or', rows: filter.or.map(memberRow) }
  return { join: 'and', rows: [{ kept: filter }] }
}

/** The rows back as a filter: nothing for no rows, the one for one, else the join. */
export function filterOf(rows: FilterRows, holds?: HoldsOf): Filter | undefined {
  const members = rows.rows.map((row): Filter =>
    'kept' in row ? row.kept : expressionOf(row, holds),
  )
  if (!members.length) return undefined
  if (members.length === 1 && rows.join === 'and') return members[0]
  return rows.join === 'and' ? { and: members } : { or: members }
}
