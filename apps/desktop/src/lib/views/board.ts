import {
  type Base,
  type CardSize,
  type Group,
  groupName,
  type Row,
  rowId,
  type Value,
  isWhen,
} from '@orden/bases'
import { bare, isNoteProperty } from './columns'

const DEFAULT_SIZE: CardSize = 'medium'

export const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large']

export function sizeOf(size: CardSize | undefined, notes: boolean): CardSize {
  return size ?? (notes ? DEFAULT_SIZE : 'small')
}

const LINES: Record<CardSize, { title: number; props: number }> = {
  small: { title: 1, props: 1 },
  medium: { title: 2, props: 2 },
  large: { title: 3, props: 3 },
}

const TITLE_LINE = 19
const PROP_LINE = 20
const PAD = 16
const GAP = 6

export function cardLines(
  size: CardSize,
  shown: number,
  extra: boolean,
): { title: number; props: number } {
  const room = LINES[size]
  return { title: room.title, props: Math.min(room.props, shown + (extra && !shown ? 1 : 0)) }
}

export function cardHeight(lines: { title: number; props: number }, touch: boolean): number {
  const props = lines.props ? 4 + lines.props * PROP_LINE : 0
  return PAD + lines.title * TITLE_LINE + props + 2 + GAP + (touch ? 12 : 0)
}

export function cardProperties(
  columns: readonly string[],
  groupBy: string | undefined,
  sub: string | undefined,
): string[] {
  return columns.filter(
    (one) => one !== 'task.text' && one !== 'file.name' && one !== groupBy && one !== sub,
  )
}

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

export const noteKey = (row: Pick<Row, 'space' | 'path'>): string => `${row.space}\n${row.path}`

export const cardKey = (row: Row): string => `${row.space}:${rowId(row)}`

export function isDoneGroup(base: Base | null, property: string | undefined, key: Value): boolean {
  if (property === 'task.status') return typeof key === 'string' && key.toLowerCase() === 'x'
  if (property === 'task.done') return key === true
  if (!base || !property || typeof key !== 'string') return false
  const option = base.nib.properties[bare(property)]?.options?.find((one) => one.value === key)
  return option?.group === 'done'
}

export function droppableBy(
  property: string | undefined,
  rows: 'notes' | 'tasks' | 'both',
): boolean {
  if (property === undefined) return false
  if (
    /^task\.(status|done|priority|due|date|scheduled|start|deadline|assignee|section|tags)$/.test(
      property,
    )
  )
    return true
  if (property === 'formula.overdue' || property === 'formula.day' || isWhen(property)) return true
  if (property === 'file.path' || property === 'file.basename') return rows !== 'notes'
  return isNoteProperty(property)
}

export interface Pending {
  card: string
  row: Row
  from: string
  to: string
  key: Value
  fromLane?: string
  lane?: Value
  index: number
  written?: boolean
}

export function withPending(groups: readonly Group[], pending: readonly Pending[]): Group[] {
  if (!pending.length) return [...groups]
  const moving = new Map(pending.map((one) => [one.card, one]))
  return groups.map((group) => {
    const name = groupName(group.key)
    const isMoving = (row: Row) => {
      const one = moving.get(cardKey(row))
      return one !== undefined && (one.from === name || one.to === name)
    }
    if (!group.rows.some(isMoving) && !pending.some((one) => one.to === name)) return group
    const rows = group.rows.filter((row) => !isMoving(row))
    let sub = group.sub?.map((lane) => {
      const laneName = groupName(lane.key)
      const kept = lane.rows.filter((row) => {
        const one = moving.get(cardKey(row))
        if (!one) return true
        if (one.to !== name) return one.from !== name
        return (
          one.lane === undefined ||
          (one.fromLane !== undefined &&
            laneName !== one.fromLane &&
            laneName !== groupName(one.lane))
        )
      })
      return kept.length === lane.rows.length ? lane : { ...lane, rows: kept }
    })
    for (const one of pending) {
      if (one.to !== name) continue
      if (one.lane === undefined || !sub) {
        rows.splice(Math.min(one.index, rows.length), 0, one.row)
        continue
      }
      const laneName = groupName(one.lane)
      let at = sub.findIndex((lane) => groupName(lane.key) === laneName)
      if (at === -1) {
        sub = [...sub, { key: one.lane, rows: [], summaries: {} }]
        at = sub.length - 1
      }
      const lane = sub[at]
      if (!lane) continue
      const laneRows = [...lane.rows]
      const before = laneRows[one.index]
      const after = laneRows.at(-1)
      const place = before ? rows.indexOf(before) : after ? rows.indexOf(after) + 1 : rows.length
      rows.splice(place === -1 ? rows.length : place, 0, one.row)
      laneRows.splice(Math.min(one.index, laneRows.length), 0, one.row)
      sub = sub.map((each, index) => (index === at ? { ...each, rows: laneRows } : each))
    }
    return sub ? { ...group, rows, sub } : { ...group, rows }
  })
}

export function withOrder(
  groups: readonly Group[],
  column: string,
  order: readonly string[],
  idOf: (row: Row) => string,
): Group[] {
  const place = new Map(order.map((id, at) => [id, at]))
  const rank = (row: Row) => place.get(idOf(row)) ?? order.length
  const sorted = (rows: readonly Row[]) => [...rows].sort((a, b) => rank(a) - rank(b))
  return groups.map((group) =>
    groupName(group.key) !== column
      ? group
      : {
          ...group,
          rows: sorted(group.rows),
          ...(group.sub
            ? { sub: group.sub.map((lane) => ({ ...lane, rows: sorted(lane.rows) })) }
            : {}),
        },
  )
}

export function mergedOrder(column: readonly string[], lane: readonly string[]): string[] {
  const out = [...column]
  lane.forEach((id, at) => {
    if (out.includes(id)) return
    const before = lane
      .slice(0, at)
      .reverse()
      .find((one) => out.includes(one))
    const after = lane.slice(at + 1).find((one) => out.includes(one))
    const place =
      before !== undefined
        ? out.indexOf(before) + 1
        : after !== undefined
          ? out.indexOf(after)
          : out.length
    out.splice(place, 0, id)
  })
  const inLane = new Set(lane)
  const next = lane[Symbol.iterator]()
  return out.map((id) => (inLane.has(id) ? (next.next().value ?? id) : id))
}

type BoardKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

export function nextCard(
  counts: readonly number[],
  at: { column: number; index: number },
  key: BoardKey,
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

export function nextLaned(
  counts: readonly (readonly number[])[],
  at: { lane: number; column: number; index: number },
  key: BoardKey,
): { lane: number; column: number; index: number } | null {
  const step = nextCard(counts[at.lane] ?? [], at, key)
  if (step) return { ...step, lane: at.lane }
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  const by = key === 'ArrowUp' ? -1 : 1
  for (let lane = at.lane + by; lane >= 0 && lane < counts.length; lane += by) {
    const count = counts[lane]?.[at.column] ?? 0
    if (count) return { lane, column: at.column, index: by < 0 ? count - 1 : 0 }
  }
  return null
}

export function orderAfter(ids: readonly string[], id: string, index: number): string[] {
  const order = ids.filter((one) => one !== id)
  order.splice(Math.min(index, order.length), 0, id)
  return order
}

export function indexWithout(index: number, was: number): number {
  return was !== -1 && was < index ? index - 1 : index
}

function someOf<T>(values: readonly T[], most: number): { shown: T[]; more: number } {
  return { shown: values.slice(0, most), more: Math.max(0, values.length - most) }
}

export type CardLine =
  | { kind: 'pills'; pills: { text: string; tone: string | null }[]; more: number }
  | { kind: 'words'; text: string; late: boolean }

const MOST_PILLS = 2

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
