import type { Edit, Focus } from './edits'
import type { Order, TableModel } from './model'

function numberIn(cell: string): number | null {
  const bare = cell
    .trim()
    .replace(/^[\p{Sc}\s]+/u, '')
    .replace(/,/g, '')
  if (!/^[+-]?\d+(\.\d+)?%?$/.test(bare)) return null
  return Number(bare.replace(/%$/, ''))
}
function dateIn(cell: string): number | null {
  const said = cell.trim()
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(said)) return null
  const at = Date.parse(said)
  return Number.isNaN(at) ? null : at
}
function compareCells(left: string, right: string): number {
  const empty = (one: string) => one.trim() === ''
  if (empty(left) || empty(right)) return empty(left) ? (empty(right) ? 0 : 1) : -1
  const oneNumber = numberIn(left)
  const otherNumber = numberIn(right)
  if (oneNumber !== null && otherNumber !== null) return oneNumber - otherNumber
  if (oneNumber !== null || otherNumber !== null) return oneNumber !== null ? -1 : 1
  const oneDate = dateIn(left)
  const otherDate = dateIn(right)
  if (oneDate !== null && otherDate !== null) return oneDate - otherDate
  if (oneDate !== null || otherDate !== null) return oneDate !== null ? -1 : 1
  return left.trim().localeCompare(right.trim(), undefined, { numeric: true, sensitivity: 'base' })
}
export function sortRows(model: TableModel, column: number, order: Order): TableModel {
  if (column < 0 || column >= model.header.length) return model
  if (model.rows.length < 2) return model
  const way = order === 'up' ? 1 : -1
  const kept = model.rows.map((row, at) => ({ row, at }))
  kept.sort((left, right) => {
    const said = compareCells(left.row[column] ?? '', right.row[column] ?? '')
    if (said === 0) return left.at - right.at
    const blank = (one: string) => one.trim() === ''
    if (blank(left.row[column] ?? '') || blank(right.row[column] ?? '')) return said
    return said * way
  })
  const rows = kept.map((one) => one.row)
  const names = model.names && kept.map((one) => model.names?.[one.at] ?? null)
  return rows.every((row, at) => row === model.rows[at]) ? model : { ...model, rows, names }
}
export function sortedColumn(base: TableModel, column: number, order: Order, focused: Focus | undefined): Edit {
  const next = sortRows(base, column, order)
  if (next === base || !focused || focused.at.row < 0) return { next, focus: focused }
  const was = base.rows[focused.at.row]
  const now = was === undefined ? -1 : next.rows.indexOf(was)
  return {
    next,
    focus: {
      at: { row: now === -1 ? focused.at.row : now, column: focused.at.column },
      offset: focused.offset,
    },
  }
}
