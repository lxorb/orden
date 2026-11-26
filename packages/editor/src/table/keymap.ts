import type { SelectionRange } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Command, EditorView } from '@codemirror/view'
import { insertTable } from '../commands'
import type { BindingSpec } from '../shortcuts'
import { stillOn } from '../shared'
import { parseTable, serializeTable } from './model'
import { lineBeside, renderedTables, type Side, tableAt, tableCrossed, tableWrite } from './navigation'
import type { Landing } from './view'
import { tableViewAt, withTableView } from './widget'

function walkInto(
  side: Side,
  move: (view: EditorView, range: SelectionRange) => SelectionRange,
  where: (view: EditorView) => Landing,
): Command {
  return (view) => {
    if (view.state.selection.ranges.length > 1) return false
    const range = view.state.selection.main
    if (!range.empty) return false
    const span = tableCrossed(view.state, range.head, move(view, range).head)
    if (!span) return false
    return tableViewAt(view, span.from)?.enter(side, where(view)) ?? false
  }
}
function reachUp(where: Landing): Command {
  return (view) => {
    const { state } = view
    const { doc } = state
    const range = state.selection.main
    if (state.selection.ranges.length > 1 || !range.empty) return false
    const line = doc.lineAt(range.head)
    if (!line.text.trim() || range.head !== line.from || line.number < 2) return false
    if (syntaxTree(state).resolveInner(line.from, 1).name !== 'Paragraph') return false
    const blank = doc.line(line.number - 1)
    if (blank.text.trim()) return false
    const span = renderedTables(state).find((one) => one.to === blank.from - 1)
    return span ? (tableViewAt(view, span.from)?.enter('below', where) ?? false) : false
  }
}
const either =
  (...commands: Command[]): Command =>
  (view) =>
    commands.some((command) => command(view))
function caretX(view: EditorView): Landing {
  const { head, goalColumn } = view.state.selection.main
  if (goalColumn !== undefined) return { x: view.contentDOM.getBoundingClientRect().left + goalColumn }
  const coords = view.coordsAtPos(head)
  return coords ? { x: coords.left } : 'start'
}
const down = (view: EditorView, range: SelectionRange) => view.moveVertically(range, true)
const up = (view: EditorView, range: SelectionRange) => view.moveVertically(range, false)
const forward = (view: EditorView, range: SelectionRange) => view.moveByChar(range, true)
const backward = (view: EditorView, range: SelectionRange) => view.moveByChar(range, false)
function editAt(view: EditorView, from: number, row: number) {
  const span = tableAt(view.state, from)
  if (!span) return
  const line = lineBeside(view.state, span, 'below')
  view.dispatch({ changes: line.changes, selection: { anchor: line.from } })
  const still = stillOn(view)
  withTableView(() => {
    if (still()) tableViewAt(view, span.from)?.focusCell({ row, column: 0 }, 'all')
  })
}
export const insertTableToEdit: Command = (view) => {
  if (!insertTable(2, 3, false)(view)) return false
  editAt(view, view.state.selection.main.head, -1)
  return true
}
const A_ROW = /^\s*\|.*[^\s|].*\|\s*$/
const beginTable: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false
  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to || !A_ROW.test(line.text)) return false
  const node = syntaxTree(state).resolveInner(line.from, 1)
  if (node.name !== 'Paragraph' || node.from !== line.from || node.to !== line.to) return false
  const model = parseTable(`${line.text}\n| - |`)
  if (!model) return false
  const written = serializeTable({ ...model, rows: [model.header.map(() => '')] })
  const under = line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim() ? '\n' : ''
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: written + under },
    selection: { anchor: line.from + written.length },
    userEvent: 'input',
    annotations: tableWrite.of(true),
  })
  editAt(view, line.from + 1, 0)
  return true
}
export const tableBindings: BindingSpec[] = [
  { id: 'table.begin', key: 'Enter', run: beginTable, contextual: true },
  { id: 'table.below', key: 'ArrowDown', run: walkInto('above', down, caretX), contextual: true },
  { id: 'table.above', key: 'ArrowUp', run: walkInto('below', up, caretX), contextual: true },
  {
    id: 'table.ahead',
    key: 'ArrowRight',
    run: walkInto('above', forward, () => 'start'),
    contextual: true,
  },
  {
    id: 'table.behind',
    key: 'ArrowLeft',
    run: walkInto('below', backward, () => 'end'),
    contextual: true,
  },
  {
    id: 'table.delete',
    key: 'Delete',
    run: walkInto('above', forward, () => 'start'),
    contextual: true,
  },
  {
    id: 'table.backspace',
    key: 'Backspace',
    run: either(
      walkInto('below', backward, () => 'end'),
      reachUp('end'),
    ),
    contextual: true,
  },
]
