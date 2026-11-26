import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Annotation, type ChangeSet, type ChangeSpec, EditorState, type Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { enclosingNamed } from '../nodes'
import { noReveal, overlaps } from '../live-preview/reveal'
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
const tableSpan = (state: EditorState, from: number, to: number): TableSpan => ({
  from: state.doc.lineAt(from).from,
  to: state.doc.lineAt(to).to,
})
export const standsAlone = (state: EditorState, from: number): boolean => state.doc.lineAt(from).from === from
export function selectedOver(state: EditorState, span: TableSpan): boolean {
  if (state.facet(noReveal)) return false
  return !state.selection.ranges.some((range) => range.from >= span.from && range.to <= span.to)
}
export function renderedTables(state: EditorState): TableSpan[] {
  const spans: TableSpan[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return true
      if (!standsAlone(state, node.from)) return false
      const span = tableSpan(state, node.from, node.to)
      if (!overlaps(state, span.from, span.to) || selectedOver(state, span)) spans.push(span)
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
      from: span.to + 2,
      to: span.to + 2,
      made: true,
      changes: { from: span.to, insert: '\n\n' },
    }
  }
  if (span.from > 0) {
    const line = doc.lineAt(span.from - 1)
    return { from: line.from, to: line.to, made: false, changes: [] }
  }
  return { from: 0, to: 0, made: true, changes: { from: 0, insert: '\n' } }
}
export const firstCell: CellAddress = { row: -1, column: 0 }
export const lastCell = (model: TableModel): CellAddress => ({
  row: model.rows.length - 1,
  column: model.header.length - 1,
})
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
export const cellBelow = (model: TableModel, at: CellAddress): CellAddress | 'below' =>
  at.row + 1 < model.rows.length ? { row: at.row + 1, column: at.column } : 'below'
export function cellAbove(at: CellAddress): CellAddress | 'above' {
  return at.row > -1 ? { row: at.row - 1, column: at.column } : 'above'
}
export const tableWrite = Annotation.define<boolean>()
let writing = 0
const collecting = new WeakMap<EditorView, ChangeSet[]>()
export function changesDuring(view: EditorView, run: () => unknown): ChangeSet[] {
  const made: ChangeSet[] = []
  collecting.set(view, made)
  try {
    run()
  } finally {
    collecting.delete(view)
  }
  return made
}
export function noteChanges(view: EditorView, changes: ChangeSet) {
  collecting.get(view)?.push(changes)
}
export function writingTable<T>(run: () => T): T {
  writing++
  try {
    return run()
  } finally {
    writing--
  }
}
export const tableWrites = EditorState.transactionExtender.of(() =>
  writing ? { annotations: tableWrite.of(true) } : null,
)
const OWN_EDITS = ['input', 'delete', 'move']
const PARSE_BUDGET = 200
const pipeless = (text: string): boolean => text.trim() !== '' && !/(^|[^\\])\|/.test(text)
function tablesBeside(made: Transaction): TableSpan[] {
  const { startState } = made
  const { doc } = startState
  const found = new Map<number, TableSpan>()
  const edited = new Set<number>()
  made.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = doc.line(Math.max(1, doc.lineAt(fromA).number - 2)).from
    const to = doc.line(Math.min(doc.lines, doc.lineAt(toA).number + 2)).to
    const said = inserted.toString()
    syntaxTree(startState).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Table') return true
        const span = { from: node.from, to: node.to }
        found.set(span.from, span)
        const within = fromA < span.to && toA > span.from
        const typedAtStart = fromA === toA && fromA === span.from && !said.endsWith('\n')
        const typedAtEnd = fromA === toA && fromA === span.to && !said.startsWith('\n')
        if (within || typedAtStart || typedAtEnd) edited.add(span.from)
        return false
      },
    })
  })
  return [...found.values()].filter((span) => !edited.has(span.from))
}
function partings(made: Transaction, span: TableSpan): ChangeSpec[] {
  const before = made.startState
  const after = made.state
  const { doc } = after
  const from = made.changes.mapPos(span.from, 1)
  const to = made.changes.mapPos(span.to, -1)
  if (doc.sliceString(from, to) !== before.doc.sliceString(span.from, span.to)) return []
  const tree = ensureSyntaxTree(after, Math.min(doc.length, to + 1), PARSE_BUDGET) ?? syntaxTree(after)
  const table = enclosingNamed(tree.resolveInner(from, 1), 'Table')
  const kept = table?.from === from ? table : null
  const parted: ChangeSpec[] = []
  const first = doc.lineAt(from)
  if (first.from < from) {
    if (pipeless(doc.sliceString(first.from, from))) parted.push({ from, insert: '\n\n' })
  } else if (from > 0 && !kept && doc.lineAt(from - 1).text.trim()) parted.push({ from, insert: '\n' })
  const last = doc.lineAt(to)
  if (last.to > to) {
    if (pipeless(doc.sliceString(to, last.to))) parted.push({ from: to, insert: '\n\n' })
  } else if (to < doc.length) {
    const next = doc.lineAt(to + 1)
    if (pipeless(next.text) && (!kept || kept.to >= next.to)) parted.push({ from: to, insert: '\n' })
  }
  return parted
}
export const tablesKeptApart = EditorState.transactionFilter.of((made) => {
  if (!made.docChanged || made.annotation(tableWrite)) return made
  if (!OWN_EDITS.some((event) => made.isUserEvent(event))) return made
  const beside = tablesBeside(made)
  if (!beside.length) return made
  const changes = beside.flatMap((span) => partings(made, span))
  return changes.length ? [made, { changes, sequential: true }] : made
})
