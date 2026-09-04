import type { SelectionRange } from '@codemirror/state'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import { insertTable } from '../commands'
import { lineBeside, type Side, tableAt, tableCrossed } from './navigation'
import type { Landing } from './view'
import { tableViewAt } from './widget'

/** A key that would carry the caret over a rendered table instead walks it
 *  into the table, into the cell nearest to where it was. The editor's own
 *  motion is asked where it would go; a table in the way is the signal. */
function walkInto(
  side: Side,
  move: (view: EditorView, range: SelectionRange) => SelectionRange,
  where: (view: EditorView) => Landing,
): Command {
  return (view) => {
    const range = view.state.selection.main
    if (!range.empty) return false

    const span = tableCrossed(view.state, range.head, move(view, range).head)
    if (!span) return false

    const table = tableViewAt(view, span.from)
    return table !== null && table.enter(side, where(view))
  }
}

/** Where the caret is, so the cell it lands in is the one straight below or
 *  above it. A run of vertical moves remembers the column it set out from,
 *  and that wins over a blank line's start. */
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

/** Inserts a table and starts on its first cell, the way Typora does. */
export const insertTableToEdit: Command = (view) => {
  insertTable()(view)

  const span = tableAt(view.state, view.state.selection.main.head)
  if (!span) return true

  // The caret has to be off the table's text for the table to render.
  const line = lineBeside(view.state, span, 'below')
  view.dispatch({ changes: line.changes, selection: { anchor: line.from } })
  tableViewAt(view, span.from)?.focusCell({ row: -1, column: 0 }, 'all')
  return true
}

export const tableKeymap: KeyBinding[] = [
  { key: 'ArrowDown', run: walkInto('above', down, caretX) },
  { key: 'ArrowUp', run: walkInto('below', up, caretX) },
  { key: 'ArrowRight', run: walkInto('above', forward, () => 'start') },
  { key: 'ArrowLeft', run: walkInto('below', backward, () => 'end') },
  // Deleting into a table from beside it would tear a row; stepping in is
  // what was meant.
  { key: 'Delete', run: walkInto('above', forward, () => 'start') },
  { key: 'Backspace', run: walkInto('below', backward, () => 'end') },
]
