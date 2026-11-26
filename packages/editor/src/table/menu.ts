import type { Align, Order, TableModel } from './model'
import type { CellAddress } from './navigation'

interface TableItem {
  label: string
  run: () => void
  danger?: boolean
  checked?: boolean
  disabled?: boolean
}
export type TableEntry = TableItem | null
export interface TableActs {
  model(): TableModel
  insertRow(at: number): void
  duplicateRow(row: number): void
  clearRow(row: number): void
  deleteRow(row: number): void
  insertColumn(at: number): void
  duplicateColumn(column: number): void
  clearColumn(column: number): void
  deleteColumn(column: number): void
  align(column: number, side: NonNullable<Align>): void
  sort(column: number, order: Order): void
}
const insertRows = (acts: TableActs, row: number): TableEntry[] => [
  { label: 'Insert row above', disabled: row < 0, run: () => acts.insertRow(row) },
  { label: 'Insert row below', run: () => acts.insertRow(row + 1) },
]
const insertColumns = (acts: TableActs, column: number): TableEntry[] => [
  { label: 'Insert column left', run: () => acts.insertColumn(column) },
  { label: 'Insert column right', run: () => acts.insertColumn(column + 1) },
]
function shaping(acts: TableActs, column: number): TableEntry[] {
  const now = acts.model().align[column]
  const side = (label: string, to: NonNullable<Align>): TableEntry => ({
    label,
    checked: now === to,
    run: () => acts.align(column, to),
  })
  const few = acts.model().rows.length < 2
  return [
    side('Align left', 'left'),
    side('Align centre', 'center'),
    side('Align right', 'right'),
    null,
    { label: 'Sort ascending', disabled: few, run: () => acts.sort(column, 'up') },
    { label: 'Sort descending', disabled: few, run: () => acts.sort(column, 'down') },
  ]
}
export const rowEntries = (acts: TableActs, row: number): TableEntry[] => [
  ...insertRows(acts, row),
  null,
  { label: 'Duplicate row', run: () => acts.duplicateRow(row) },
  { label: 'Clear row', run: () => acts.clearRow(row) },
  null,
  { label: 'Delete row', danger: true, run: () => acts.deleteRow(row) },
]
export const columnEntries = (acts: TableActs, column: number): TableEntry[] => [
  ...insertColumns(acts, column),
  null,
  ...shaping(acts, column),
  null,
  { label: 'Duplicate column', run: () => acts.duplicateColumn(column) },
  { label: 'Clear column', run: () => acts.clearColumn(column) },
  null,
  {
    label: 'Delete column',
    danger: true,
    disabled: acts.model().header.length < 2,
    run: () => acts.deleteColumn(column),
  },
]
export const cellEntries = (acts: TableActs, at: CellAddress): TableEntry[] => [
  ...insertRows(acts, at.row),
  ...insertColumns(acts, at.column),
  null,
  ...shaping(acts, at.column),
  null,
  { label: 'Delete row', danger: true, disabled: at.row < 0, run: () => acts.deleteRow(at.row) },
  {
    label: 'Delete column',
    danger: true,
    disabled: acts.model().header.length < 2,
    run: () => acts.deleteColumn(at.column),
  },
]
