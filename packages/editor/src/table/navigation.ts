import { syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState } from '@codemirror/state'
import { overlaps } from '../live-preview/reveal'
import type { TableModel } from './model'

/** The lines a rendered table stands in for. */
export interface TableSpan {
  from: number
  to: number
}

/** A cell by position. The header is row -1, so a body row's number is its
 *  index in the model. */
export interface CellAddress {
  row: number
  column: number
}

/** Which way the caret goes when it steps out of a table. */
export type Side = 'above' | 'below'

/** Where a step from a cell ends up: another cell, or out of the table. */
export type Step = CellAddress | Side

/** The whole-line span of a Table node - what its widget replaces. */
export function tableSpan(state: EditorState, from: number, to: number): TableSpan {
  return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to }
}

/** Every table the caret is not in, which are the ones shown rendered. */
export function renderedTables(state: EditorState): TableSpan[] {
  const spans: TableSpan[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return true
      const span = tableSpan(state, node.from, node.to)
      if (!overlaps(state, span.from, span.to)) spans.push(span)
      return false
    },
  })
  return spans
}

/** The table whose text holds a position, rendered or not. */
export function tableAt(state: EditorState, pos: number): TableSpan | null {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node.parent; node = node.parent) {
    if (node.name === 'Table') return tableSpan(state, node.from, node.to)
  }
  return null
}

/** The rendered table a caret move from one position to another would pass
 *  over or land in. The editor's own motions skip a block widget whole, or
 *  stop at the edge of its text; either way the table lies between the two. */
export function tableCrossed(state: EditorState, from: number, to: number): TableSpan | null {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  return (
    renderedTables(state).find(
      (span) => (span.from > low && span.from <= high) || (span.to >= low && span.to < high),
    ) ?? null
  )
}

/** The line the caret lands on when it leaves a table. A table that is the
 *  first or last thing in the document has no such line, so one is made:
 *  otherwise there would be no way to write above or below it. */
export function lineBeside(
  state: EditorState,
  span: TableSpan,
  side: Side,
): { from: number; to: number; changes?: ChangeSpec } {
  const { doc } = state

  if (side === 'below') {
    if (span.to < doc.length) {
      const line = doc.lineAt(span.to + 1)
      return { from: line.from, to: line.to }
    }
    return { from: span.to + 1, to: span.to + 1, changes: { from: span.to, insert: '\n' } }
  }

  if (span.from > 0) {
    const line = doc.lineAt(span.from - 1)
    return { from: line.from, to: line.to }
  }
  return { from: 0, to: 0, changes: { from: 0, insert: '\n' } }
}

export const firstCell: CellAddress = { row: -1, column: 0 }

export function lastCell(model: TableModel): CellAddress {
  return { row: model.rows.length - 1, column: model.header.length - 1 }
}

/** Reading order: along the row, then on to the next. */
export function cellAfter(model: TableModel, at: CellAddress): Step {
  if (at.column + 1 < model.header.length) return { row: at.row, column: at.column + 1 }
  if (at.row + 1 < model.rows.length) return { row: at.row + 1, column: 0 }
  return 'below'
}

export function cellBefore(model: TableModel, at: CellAddress): Step {
  if (at.column > 0) return { row: at.row, column: at.column - 1 }
  if (at.row > -1) return { row: at.row - 1, column: model.header.length - 1 }
  return 'above'
}

export function cellBelow(model: TableModel, at: CellAddress): CellAddress | 'below' {
  return at.row + 1 < model.rows.length ? { row: at.row + 1, column: at.column } : 'below'
}

export function cellAbove(at: CellAddress): CellAddress | 'above' {
  return at.row > -1 ? { row: at.row - 1, column: at.column } : 'above'
}
