import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  setAlign,
  sortRows,
  type Align,
  type Order,
  type TableModel,
} from './model'
import type { CellAddress } from './navigation'

export interface Focus {
  at: CellAddress
  offset: number
}

export interface Edit {
  next: TableModel
  focus: Focus | undefined
}

export function alignedColumn(
  base: TableModel,
  column: number,
  align: NonNullable<Align>,
  focused: Focus | undefined,
): Edit {
  return {
    next: setAlign(base, column, align === base.align[column] ? null : align),
    focus: focused,
  }
}

function afterRemoval(index: number, removed: number, left: number): number {
  return Math.min(index > removed ? index - 1 : index, left - 1)
}

export function movedColumn(
  base: TableModel,
  column: number,
  step: number,
  focused: Focus | undefined,
): Edit {
  const next = moveColumn(base, column, column + step)
  if (next === base || !focused) return { next, focus: focused }

  const landed = focused.at.column === column ? column + step : focused.at.column
  return {
    next,
    focus: {
      at: { row: focused.at.row, column: Math.max(0, Math.min(landed, next.header.length - 1)) },
      offset: focused.offset,
    },
  }
}

export function insertedColumn(base: TableModel, after: number): Edit {
  return {
    next: insertColumn(base, after + 1),
    focus: { at: { row: -1, column: after + 1 }, offset: 0 },
  }
}

export function removedColumn(base: TableModel, column: number, focused: Focus | undefined): Edit {
  const next = removeColumn(base, column)
  if (next === base || !focused) return { next, focus: focused }

  return {
    next,
    focus: {
      at: {
        row: focused.at.row,
        column: Math.max(0, afterRemoval(focused.at.column, column, next.header.length)),
      },
      offset: focused.offset,
    },
  }
}

export function sortedColumn(
  base: TableModel,
  column: number,
  order: Order,
  focused: Focus | undefined,
): Edit {
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

export function movedRow(
  base: TableModel,
  row: number,
  step: number,
  focused: Focus | undefined,
): Edit {
  const next = moveRow(base, row, row + step)
  if (next === base || !focused) return { next, focus: focused }

  return {
    next,
    focus: {
      at: {
        row: focused.at.row === row ? row + step : focused.at.row,
        column: focused.at.column,
      },
      offset: focused.offset,
    },
  }
}

export function insertedRow(base: TableModel, after: number, column = 0): Edit {
  return { next: insertRow(base, after + 1), focus: { at: { row: after + 1, column }, offset: 0 } }
}

export function removedRow(base: TableModel, row: number, focused: Focus | undefined): Edit {
  const next = removeRow(base, row)
  if (next === base || !focused) return { next, focus: focused }

  return {
    next,
    focus: {
      at: { row: afterRemoval(focused.at.row, row, next.rows.length), column: focused.at.column },
      offset: focused.offset,
    },
  }
}
