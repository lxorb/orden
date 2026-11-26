import { setCell, type TableModel } from './model'
import type { CellAddress } from './navigation'

type Grid = string[][]
export interface CellRange {
  anchor: CellAddress
  head: CellAddress
}
export interface CellRect {
  top: number
  bottom: number
  left: number
  right: number
}
export const rectOf = ({ anchor, head }: CellRange): CellRect => ({
  top: Math.min(anchor.row, head.row),
  bottom: Math.max(anchor.row, head.row),
  left: Math.min(anchor.column, head.column),
  right: Math.max(anchor.column, head.column),
})
export const inRect = (rect: CellRect, at: CellAddress): boolean =>
  at.row >= rect.top && at.row <= rect.bottom && at.column >= rect.left && at.column <= rect.right
const lastRow = (model: TableModel) => model.rows.length - 1
const lastColumn = (model: TableModel) => model.header.length - 1
export const wholeTable = (model: TableModel): CellRange => ({
  anchor: { row: -1, column: 0 },
  head: { row: lastRow(model), column: lastColumn(model) },
})
export const rowRange = (model: TableModel, row: number): CellRange => ({
  anchor: { row, column: 0 },
  head: { row, column: lastColumn(model) },
})
export const columnRange = (model: TableModel, column: number): CellRange => ({
  anchor: { row: lastRow(model), column },
  head: { row: -1, column },
})
export function coversTable(model: TableModel, range: CellRange): boolean {
  const rect = rectOf(range)
  return rect.top === -1 && rect.left === 0 && rect.bottom === lastRow(model) && rect.right === lastColumn(model)
}
export function clamped(model: TableModel, range: CellRange): CellRange {
  const fit = (at: CellAddress): CellAddress => ({
    row: Math.max(-1, Math.min(lastRow(model), at.row)),
    column: Math.max(0, Math.min(lastColumn(model), at.column)),
  })
  return { anchor: fit(range.anchor), head: fit(range.head) }
}
export type Way = 'up' | 'down' | 'left' | 'right'
export function extended(model: TableModel, range: CellRange, way: Way): CellRange {
  const { row, column } = range.head
  const head = {
    row: row + (way === 'up' ? -1 : way === 'down' ? 1 : 0),
    column: column + (way === 'left' ? -1 : way === 'right' ? 1 : 0),
  }
  return clamped(model, { anchor: range.anchor, head })
}
const textAt = (model: TableModel, row: number, column: number): string =>
  (row < 0 ? model.header[column] : model.rows[row]?.[column]) ?? ''
export function gridIn(model: TableModel, rect: CellRect): Grid {
  const grid: Grid = []
  for (let row = rect.top; row <= rect.bottom; row++) {
    const cells: string[] = []
    for (let column = rect.left; column <= rect.right; column++) cells.push(textAt(model, row, column))
    grid.push(cells)
  }
  return grid
}
export function filled(model: TableModel, rect: CellRect, text: string): TableModel {
  let next = model
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let column = rect.left; column <= rect.right; column++) {
      if (textAt(next, row, column) !== text) next = setCell(next, row, column, text)
    }
  }
  return next
}
const plain = (cell: string): string => cell.replace(/\\\|/g, '|')
export const gridText = (grid: Grid): string => grid.map((cells) => cells.map(plain).join('\t')).join('\n')
const escaped = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const gridHtml = (grid: Grid): string =>
  `<table>${grid.map((cells) => `<tr>${cells.map((cell) => `<td>${escaped(plain(cell))}</td>`).join('')}</tr>`).join('')}</table>`
