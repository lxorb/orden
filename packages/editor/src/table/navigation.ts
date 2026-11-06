import { syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState } from '@codemirror/state'
import { enclosingNamed } from '../nodes'
import { overlaps } from '../live-preview/reveal'
import type { TableModel } from './model'

export interface TableSpan {
  from: number
  to: number
}

export interface CellAddress {
  row: number
  column: number
}

export type Side = 'above' | 'below'

export type Step = CellAddress | Side

function tableSpan(state: EditorState, from: number, to: number): TableSpan {
  return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to }
}

export function standsAlone(state: EditorState, from: number): boolean {
  return state.doc.lineAt(from).from === from
}

export function renderedTables(state: EditorState): TableSpan[] {
  const spans: TableSpan[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return true
      if (!standsAlone(state, node.from)) return false

      const span = tableSpan(state, node.from, node.to)
      if (!overlaps(state, span.from, span.to)) spans.push(span)
      return false
    },
  })
  return spans
}

export function tableAt(state: EditorState, pos: number): TableSpan | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, -1), 'Table')
  return node && tableSpan(state, node.from, node.to)
}

export function tableCrossed(state: EditorState, from: number, to: number): TableSpan | null {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  return (
    renderedTables(state).find(
      (span) => (span.from > low && span.from <= high) || (span.to >= low && span.to < high),
    ) ?? null
  )
}

export interface LineBeside {
  from: number
  to: number
  made: boolean
  changes: ChangeSpec
}

export function lineBeside(state: EditorState, span: TableSpan, side: Side): LineBeside {
  const { doc } = state

  if (side === 'below') {
    if (span.to < doc.length) {
      const line = doc.lineAt(span.to + 1)
      return { from: line.from, to: line.to, made: false, changes: [] }
    }
    return {
      from: span.to + 1,
      to: span.to + 1,
      made: true,
      changes: { from: span.to, insert: '\n' },
    }
  }

  if (span.from > 0) {
    const line = doc.lineAt(span.from - 1)
    return { from: line.from, to: line.to, made: false, changes: [] }
  }
  return { from: 0, to: 0, made: true, changes: { from: 0, insert: '\n' } }
}

export const firstCell: CellAddress = { row: -1, column: 0 }

export function lastCell(model: TableModel): CellAddress {
  return { row: model.rows.length - 1, column: model.header.length - 1 }
}

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
