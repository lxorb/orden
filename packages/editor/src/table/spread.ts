import { pastedMarkdown } from '../paste'
import type { Edit } from './edits'
import { insertColumn, insertRow, parseTable, setCell, type TableModel } from './model'
import type { CellAddress } from './navigation'

export type Grid = string[][]
const many = (grid: Grid): Grid | null => (grid.length > 1 || (grid[0]?.length ?? 0) > 1 ? grid : null)
export function tabbedGrid(text: string): Grid | null {
  if (!text.includes('\t')) return null
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  return many(lines.map((line) => line.split('\t').map((cell) => cell.trim())))
}
export function writtenGrid(markdown: string | null): Grid | null {
  const lines = (markdown ?? '').trim().split('\n')
  if (lines.length < 2 || !lines.every((line) => line.trim().startsWith('|'))) return null
  const model = parseTable(lines.join('\n'))
  if (!model) return null
  const headless = model.header.every((cell) => !cell)
  return many(headless ? model.rows : [model.header, ...model.rows])
}
export const mayHoldTable = (html: string, text: string): boolean =>
  /<table\b/i.test(html) || /^\s*\|.*\|\s*\n\s*\|?\s*:?-+/.test(text)
export function spreadOver(base: TableModel, at: CellAddress, grid: Grid): Edit {
  const wide = grid.reduce((most, cells) => Math.max(most, cells.length), 0)
  let next = base
  while (next.rows.length < at.row + grid.length) next = insertRow(next, next.rows.length)
  while (next.header.length < at.column + wide) next = insertColumn(next, next.header.length)
  grid.forEach((cells, down) => {
    cells.forEach((text, across) => {
      next = setCell(next, at.row + down, at.column + across, text)
    })
  })
  const last = { row: at.row + grid.length - 1, column: at.column + Math.max(1, wide) - 1 }
  const landed = (last.row < 0 ? next.header : next.rows[last.row])?.[last.column] ?? ''
  return { next, focus: { at: last, offset: landed.length } }
}
export async function gridOf(
  html: string,
  text: string,
): Promise<((base: TableModel, at: CellAddress) => Edit) | null> {
  const grid = tabbedGrid(text) ?? (mayHoldTable(html, text) ? writtenGrid(await pastedMarkdown(html, text)) : null)
  return grid && ((base, at) => spreadOver(base, at, grid))
}
