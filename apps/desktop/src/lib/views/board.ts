/** A board's arithmetic, apart from what draws it: how tall its cards are, which
 *  properties they show, a note's checklist, which groups are done, where a card
 *  carried but not yet written stands, and where the arrow keys go. Pure. */

import {
  type Base,
  type CardSize,
  type Group,
  groupName,
  type Row,
  rowId,
  type Value,
} from '@nib/bases'
import { bare, isNoteProperty } from './columns'

/** The size a board's cards are where its view says none: Notion's own default. */
export const DEFAULT_SIZE: CardSize = 'medium'

export const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large']

/** How many lines a card's title takes at most, and how many property lines it has
 *  room for, at each size. */
const LINES: Record<CardSize, { title: number; props: number }> = {
  small: { title: 1, props: 1 },
  medium: { title: 2, props: 2 },
  large: { title: 3, props: 3 },
}

/** One line of a card's title and of a property under it, its padding and its border,
 *  and the gap between cards, in pixels; a thumb's card is roomier. */
const TITLE_LINE = 19
const PROP_LINE = 20
const PAD = 16
const GAP = 6

/** The lines a card of this size has: its title's and its properties', which every
 *  card of the view keeps, filled or not, so every card is one height. `shown` is how
 *  many properties the view puts on its cards; `extra` a line every card keeps for its
 *  checklist or its task's chips where the view shows no property. */
export function cardLines(
  size: CardSize,
  shown: number,
  extra: boolean,
): { title: number; props: number } {
  const room = LINES[size]
  return { title: room.title, props: Math.min(room.props, shown + (extra && !shown ? 1 : 0)) }
}

/** A card's height on the board, the gap after it included. */
export function cardHeight(lines: { title: number; props: number }, touch: boolean): number {
  const props = lines.props ? 4 + lines.props * PROP_LINE : 0
  return PAD + lines.title * TITLE_LINE + props + 2 + GAP + (touch ? 12 : 0)
}

/** What a card shows under its title: the view's properties in its order, but the
 *  title itself and what the columns and lanes already say. */
export function cardProperties(
  columns: readonly string[],
  groupBy: string | undefined,
  sub: string | undefined,
): string[] {
  return columns.filter(
    (one) => one !== 'task.text' && one !== 'file.name' && one !== groupBy && one !== sub,
  )
}

/** A note's own checklist, its task lines done of all of them, by note. */
export function checklists(rows: readonly Row[]): Map<string, { done: number; total: number }> {
  const out = new Map<string, { done: number; total: number }>()
  for (const row of rows) {
    if (row.kind !== 'task' || !row.task || row.task.cancelled) continue
    const key = noteKey(row)
    const was = out.get(key) ?? { done: 0, total: 0 }
    out.set(key, { done: was.done + (row.task.done ? 1 : 0), total: was.total + 1 })
  }
  return out
}

/** A note named apart from every other space's. */
export const noteKey = (row: Pick<Row, 'space' | 'path'>): string => `${row.space}\n${row.path}`

/** A card named apart from every other card on screen. */
export const cardKey = (row: Row): string => `${row.space}:${rowId(row)}`

/** Whether a group is one of the done ones: its option's group is Done, Notion's
 *  Complete, or a task's box is ticked. */
export function isDoneGroup(base: Base | null, property: string | undefined, key: Value): boolean {
  if (property === 'task.status') return typeof key === 'string' && key.toLowerCase() === 'x'
  if (property === 'task.done') return key === true
  if (!base || !property || typeof key !== 'string') return false
  const option = base.nib.properties[bare(property)]?.options?.find((one) => one.value === key)
  return option?.group === 'done'
}

/** Whether a drop into a group of this grouping can be written: a note's property, a
 *  task's field, the days and halves of the views nib ships. A formula, a rollup or a
 *  file's facts cannot. */
export function droppableBy(
  property: string | undefined,
  rows: 'notes' | 'tasks' | 'both',
): boolean {
  if (property === undefined) return false
  if (
    /^task\.(status|done|priority|due|date|scheduled|start|deadline|assignee|section)$/.test(
      property,
    )
  )
    return true
  if (property === 'formula.overdue' || property === 'formula.day') return true
  if (property === 'file.path' || property === 'file.basename') return rows !== 'notes'
  return isNoteProperty(property)
}

/** A card carried to another column and not written yet, so it stands there at once. */
export interface Pending {
  card: string
  row: Row
  /** The column it was carried out of, and the one it went to, by key as text. */
  from: string
  to: string
  key: Value
  /** Where among the new column's cards it was let go. */
  index: number
  /** Written, and waiting for the rows to say so. */
  written?: boolean
}

/** The groups with each pending card where it was carried to. */
export function withPending(groups: readonly Group[], pending: readonly Pending[]): Group[] {
  if (!pending.length) return [...groups]
  const moving = new Map(pending.map((one) => [one.card, one]))
  return groups.map((group) => {
    const name = groupName(group.key)
    let rows = group.rows.filter((row) => {
      const one = moving.get(cardKey(row))
      return !one || (one.from !== name && one.to !== name)
    })
    for (const one of pending) {
      if (one.to !== name) continue
      rows = [...rows]
      rows.splice(Math.min(one.index, rows.length), 0, one.row)
    }
    return rows === group.rows ? group : { ...group, rows }
  })
}

/** Where the keyboard goes from a card (`column`, `index`) on a board whose columns
 *  hold `counts` cards: up and down a column, left and right to the card at the same
 *  height in the next column that has any, or its add row (index = its count) where it
 *  has none. Null where there is nowhere. */
export function nextCard(
  counts: readonly number[],
  at: { column: number; index: number },
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
): { column: number; index: number } | null {
  const count = counts[at.column] ?? 0
  if (key === 'ArrowUp') return at.index > 0 ? { ...at, index: at.index - 1 } : null
  if (key === 'ArrowDown') return at.index < count - 1 ? { ...at, index: at.index + 1 } : null
  if (key === 'Home') return count ? { ...at, index: 0 } : null
  if (key === 'End') return count ? { ...at, index: count - 1 } : null
  const step = key === 'ArrowLeft' ? -1 : 1
  const column = at.column + step
  if (column < 0 || column >= counts.length) return null
  const there = counts[column] ?? 0
  return { column, index: Math.min(at.index, Math.max(0, there - 1)) }
}

/** The ids a column's manual order is written with after a card is let go at `index`
 *  among `ids`, the column's cards as they stand without it. */
export function orderAfter(ids: readonly string[], id: string, index: number): string[] {
  const order = ids.filter((one) => one !== id)
  order.splice(Math.min(index, order.length), 0, id)
  return order
}

/** The members a card shows of a list, and how many more there are. */
function someOf<T>(values: readonly T[], most: number): { shown: T[]; more: number } {
  return { shown: values.slice(0, most), more: Math.max(0, values.length - most) }
}

/** One property line of a card: pills for a select or a list, words for the rest. */
export type CardLine =
  | { kind: 'pills'; pills: { text: string; tone: string | null }[]; more: number }
  | { kind: 'words'; text: string; late: boolean }

/** How many members of a list a card's line shows before saying how many more. */
const MOST_PILLS = 2

/** A property's value as a card's line shows it, `done` saying the card is done, so a
 *  date past is not late. Null for a value that shows nothing. */
export function cardLine(
  value: Value,
  options: (value: string) => string | null | undefined,
  words: (value: Value) => string,
  today: string,
  done: boolean,
): CardLine | null {
  if (value === null || value === '') return null
  if (Array.isArray(value)) {
    const members = value.filter((one) => one !== null && words(one) !== '')
    if (!members.length) return null
    const { shown, more } = someOf(members, MOST_PILLS)
    return {
      kind: 'pills',
      pills: shown.map((one) => ({
        text: words(one),
        tone: typeof one === 'string' ? (options(one) ?? null) : null,
      })),
      more,
    }
  }
  if (typeof value === 'string') {
    const tone = options(value)
    if (tone !== undefined) return { kind: 'pills', pills: [{ text: value, tone }], more: 0 }
  }
  const text = words(value)
  if (!text) return null
  const late =
    !done &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'date' &&
    typeof value.iso === 'string' &&
    value.iso.slice(0, 10) < today
  return { kind: 'words', text, late }
}
