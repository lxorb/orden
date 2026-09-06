import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  setAlign,
  type Align,
  type TableModel,
} from './model'
import type { CellAddress } from './navigation'

/** What the controls in a table's margins do: the model they produce, and where
 *  the caret belongs afterwards.
 *
 *  The second half is the part worth having on its own. Every one of these
 *  changes which cell holds which text, so a caret that stays at the index it
 *  was on ends up somewhere else - a column to the right of a deleted one is
 *  one to the left now, a row that moved down took its caret with it. Getting
 *  that wrong is not a crash; it is the caret quietly appearing in the wrong
 *  cell, which is why it is written where it can be read and tested.
 *
 *  Nothing here touches the document or the DOM: view.ts dispatches the model
 *  and acts on the caret. */

/** A cell and how far into its text the caret sits. */
export interface Focus {
  at: CellAddress
  offset: number
}

/** A model to write, and the caret to put back. `next` being the model that
 *  came in means nothing changed and nothing should be written. */
export interface Edit {
  next: TableModel
  focus: Focus | undefined
}

/** Alignment changes nothing about the text, so the caret does not move - not
 *  even to the start of its own cell. */
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

/** Where a caret at `index` belongs once the one at `removed` has gone: one
 *  place earlier when it was after the removal, the same place otherwise, and
 *  never past the end of what is left. */
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

  // The caret follows its own text: only the column that moved goes with it,
  // and wherever it lands is clamped to what is there.
  const landed = focused.at.column === column ? column + step : focused.at.column
  return {
    next,
    focus: {
      at: { row: focused.at.row, column: Math.max(0, Math.min(landed, next.header.length - 1)) },
      offset: focused.offset,
    },
  }
}

/** A new column takes the caret, since it is empty and waiting to be typed in. */
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

export function movedRow(
  base: TableModel,
  row: number,
  step: number,
  focused: Focus | undefined,
): Edit {
  const next = moveRow(base, row, row + step)
  if (next === base || !focused) return { next, focus: focused }

  // Only a caret that was in the row that moved goes with it.
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

/** A new row takes the caret too. Which column it lands in is the caller's:
 *  Tab past the last cell starts the new row at its first column, while the
 *  margin's add button keeps the column the pointer was in. */
export function insertedRow(base: TableModel, after: number, column = 0): Edit {
  return { next: insertRow(base, after + 1), focus: { at: { row: after + 1, column }, offset: 0 } }
}

export function removedRow(base: TableModel, row: number, focused: Focus | undefined): Edit {
  const next = removeRow(base, row)
  if (next === base || !focused) return { next, focus: focused }

  // A table left with no body rows clamps the caret to -1, the header, which is
  // the one row a table always has.
  return {
    next,
    focus: {
      at: { row: afterRemoval(focused.at.row, row, next.rows.length), column: focused.at.column },
      offset: focused.offset,
    },
  }
}
