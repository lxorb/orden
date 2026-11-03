/** What Tab and Alt and the arrows do where a line is more than a line: a list item
 *  nests under the words above it, and a line steps over a table whole. Fetched through
 *  line-door.ts, since neither is needed before somebody presses one of them. */

import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands'
import { indentUnit, syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Line,
  type StateCommand,
} from '@codemirror/state'
import { inCode } from './code'
import { selectedLines } from './commands'
import { enclosingNamed } from './nodes'

const INDENT = /^\s*/

/** A list item's parts: its indent, its number if it has one, its delimiter or bullet,
 *  and the blanks before its words. */
const AN_ITEM = /^( *)(?:(\d+)([.)])|([-*+]))( +)/u

interface Item {
  indent: number
  /** Where its words begin, which is how far in a child of it has to sit. */
  column: number
  number: number | null
}

function itemOf(text: string): Item | null {
  const found = AN_ITEM.exec(text)
  if (!found) return null

  const indent = found[1]?.length ?? 0
  return {
    indent,
    column: found[0].length,
    number: found[2] === undefined ? null : Number(found[2]),
  }
}

/** The nearest item above a line standing no deeper than `depth`, or null where
 *  something else ends the list first. */
function itemAbove(state: EditorState, number: number, depth: number): Item | null {
  for (let at = number - 1; at >= 1; at--) {
    const text = state.doc.line(at).text
    if (!text.trim()) continue

    const item = itemOf(text)
    if (item && item.indent <= depth) return item
    // Words at the margin are not part of any item's continuation.
    if (!item && !/^\s/u.test(text)) return null
  }

  return null
}

/** Whether a command's lines hold a list item it can place, rather than a plain indent. */
function itemLines(state: EditorState): boolean {
  return selectedLines(state).some(
    (line) => itemOf(line.text) !== null && !inCode(state, line.from),
  )
}

/** The change a list item's line takes to stand `to` spaces in, counting on from the
 *  item above it at that depth. A number kept would say the wrong thing: `2.` as the
 *  first of a new list starts it at two, the way Obsidian and Typora don't. */
function placeItem(state: EditorState, line: Line, item: Item, to: number): ChangeSpec[] {
  const out: ChangeSpec[] = [
    to > item.indent
      ? { from: line.from, insert: ' '.repeat(to - item.indent) }
      : { from: line.from, to: line.from + item.indent - to },
  ]
  if (item.number === null) return out

  const above = itemAbove(state, line.number, to)
  const number = above?.indent === to && above.number !== null ? above.number + 1 : 1
  const digits = String(item.number).length
  out.push({
    from: line.from + item.indent,
    to: line.from + item.indent + digits,
    insert: String(number),
  })
  return out
}

/** One step in by the key: a list item as far as the words of the item above it, which
 *  is what nests it. Two spaces under `1. ` are not enough, and the list stays flat
 *  with a stray indent. Everything else is the library's own step. */
export const indentItems: StateCommand = (target) => {
  const { state, dispatch } = target
  if (!itemLines(state)) return indentMore(target)
  if (state.readOnly) return false

  const unit = state.facet(indentUnit)
  const changes: ChangeSpec[] = []
  let step = unit.length
  for (const line of selectedLines(state)) {
    const item = inCode(state, line.from) ? null : itemOf(line.text)
    if (!item) {
      changes.push({ from: line.from, insert: ' '.repeat(step) })
      continue
    }

    const above = itemAbove(state, line.number, item.indent)
    step = above?.indent === item.indent ? above.column - item.indent : unit.length
    changes.push(...placeItem(state, line, item, item.indent + step))
  }

  const set = state.changes(changes)
  dispatch(
    state.update({
      changes: set,
      selection: state.selection.map(set, 1),
      userEvent: 'input.indent',
    }),
  )
  return true
}

/** One step back out, to where the item it is nested in stands. */
export const outdentItems: StateCommand = (target) => {
  const { state, dispatch } = target
  if (!itemLines(state)) return indentLess(target)
  if (state.readOnly) return false

  const changes: ChangeSpec[] = []
  let step = state.facet(indentUnit).length
  for (const line of selectedLines(state)) {
    const item = inCode(state, line.from) ? null : itemOf(line.text)
    if (!item) {
      const blanks = (INDENT.exec(line.text)?.[0] ?? '').length
      if (blanks) changes.push({ from: line.from, to: line.from + Math.min(step, blanks) })
      continue
    }

    const above = item.indent > 0 ? itemAbove(state, line.number, item.indent - 1) : null
    const to = above ? above.indent : Math.max(0, item.indent - step)
    step = item.indent - to
    if (step > 0) changes.push(...placeItem(state, line, item, to))
  }

  const set = state.changes(changes)
  dispatch(
    state.update({
      changes: set,
      selection: state.selection.map(set, 1),
      userEvent: 'delete.dedent',
    }),
  )
  return true
}

/** The table a line would step into next, with or without a blank line between. */
function tableBeside(
  state: EditorState,
  line: Line,
  delta: -1 | 1,
): { from: number; to: number } | null {
  const doc = state.doc
  const inDoc = (number: number) => number >= 1 && number <= doc.lines
  let near = line.number + delta
  if (inDoc(near) && !doc.line(near).text.trim()) near += delta
  if (!inDoc(near)) return null

  const at = doc.line(near).from
  return enclosingNamed(syntaxTree(state).resolveInner(at, 1), 'Table')
}

/** Alt and the arrows, stepping over a table as one thing. A table is drawn as one, and
 *  a line moved a line at a time goes through its source: a row of it or the words over
 *  its head. A blank line stays between them, or the line is read as a row. */
export function moveLineOver(delta: -1 | 1): StateCommand {
  return (target) => {
    const { state, dispatch } = target
    const library = delta < 0 ? moveLineUp : moveLineDown
    const range = state.selection.main
    if (state.selection.ranges.length > 1) return library(target)

    const first = state.doc.lineAt(range.from)
    const last = state.doc.lineAt(range.to)
    const table = tableBeside(state, delta < 0 ? first : last, delta)
    const inside = enclosingNamed(syntaxTree(state).resolveInner(first.from, 1), 'Table')
    if (!table || inside || state.readOnly) return library(target)

    const moved = state.doc.sliceString(first.from, last.to)
    const held = state.doc.sliceString(table.from, table.to)
    const from = delta < 0 ? table.from : first.from
    const to = delta < 0 ? last.to : table.to
    const shift = delta < 0 ? table.from - first.from : held.length + 2
    dispatch(
      state.update({
        changes: { from, to, insert: delta < 0 ? `${moved}\n\n${held}` : `${held}\n\n${moved}` },
        selection: EditorSelection.range(range.anchor + shift, range.head + shift),
        scrollIntoView: true,
        userEvent: 'move.line',
      }),
    )
    return true
  }
}
