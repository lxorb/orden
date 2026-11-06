import type { SelectionRange } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { insertTable } from '../commands'
import type { BindingSpec } from '../shortcuts'
import { lineBeside, type Side, tableAt, tableCrossed } from './navigation'
import type { Landing } from './view'
import { tableViewAt } from './widget'

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

function caretX(view: EditorView): Landing {
  const { head, goalColumn } = view.state.selection.main
  if (goalColumn !== undefined)
    return { x: view.contentDOM.getBoundingClientRect().left + goalColumn }

  const coords = view.coordsAtPos(head)
  return coords ? { x: coords.left } : 'start'
}

const down = (view: EditorView, range: SelectionRange) => view.moveVertically(range, true)
const up = (view: EditorView, range: SelectionRange) => view.moveVertically(range, false)
const forward = (view: EditorView, range: SelectionRange) => view.moveByChar(range, true)
const backward = (view: EditorView, range: SelectionRange) => view.moveByChar(range, false)

export const insertTableToEdit: Command = (view) => {
  insertTable()(view)

  const span = tableAt(view.state, view.state.selection.main.head)
  if (!span) return true

  const line = lineBeside(view.state, span, 'below')
  view.dispatch({ changes: line.changes, selection: { anchor: line.from } })
  tableViewAt(view, span.from)?.focusCell({ row: -1, column: 0 }, 'all')
  return true
}

export const tableBindings: BindingSpec[] = [
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
    run: walkInto('below', backward, () => 'end'),
    contextual: true,
  },
]
