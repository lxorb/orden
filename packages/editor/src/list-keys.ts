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

/** A list item's parts: the quote marks it stands in, its indent, its number if it has
 *  one, its delimiter or bullet, and the blanks before its words. */
const AN_ITEM = /^((?:[ \t]*>[ \t]?)*)( *)(?:(\d+)([.)])|([-*+]))( +)/u

const QUOTE = /^(?:[ \t]*>[ \t]?)*/u

interface Item {
  /** How much of the line is quote marks. Everything else counts from past them. */
  quote: number
  indent: number
  /** Where its words begin, which is how far in a child of it has to sit. */
  column: number
  number: number | null
  digits: number
}

function itemOf(text: string): Item | null {
  const found = AN_ITEM.exec(text)
  if (!found) return null

  const quote = found[1]?.length ?? 0
  return {
    quote,
    indent: found[2]?.length ?? 0,
    column: found[0].length - quote,
    number: found[3] === undefined ? null : Number(found[3]),
    digits: found[3]?.length ?? 0,
  }
}

function quoteOf(text: string): number {
  return QUOTE.exec(text)?.[0].length ?? 0
}

/** The nearest item above a line standing no deeper than `depth`, or null where
 *  something else ends the list first. */
function itemAbove(state: EditorState, number: number, depth: number): Item | null {
  for (let at = number - 1; at >= 1; at--) {
    const text = state.doc.line(at).text
    const words = text.slice(quoteOf(text))
    if (!words.trim()) continue

    const item = itemOf(text)
    if (item && item.indent <= depth) return item
    // Words at the margin are not part of any item's continuation.
    if (!item && !/^\s/u.test(words)) return null
  }

  return null
}

/** Whether a command's lines hold a list item it can place, rather than a plain indent. */
function itemLines(state: EditorState): boolean {
  return selectedLines(state).some(
    (line) => itemOf(line.text) !== null && !inCode(state, line.from),
  )
}

/** The lines that hang from an item, which go where it goes: what is deeper than it,
 *  down to the first line that is not, and no blank line past the last of them. */
function hanging(state: EditorState, line: Line, item: Item): Line[] {
  const held: Line[] = []
  let blanks: Line[] = []
  for (let at = line.number + 1; at <= state.doc.lines; at++) {
    const below = state.doc.line(at)
    const words = below.text.slice(quoteOf(below.text))
    if (!words.trim()) {
      blanks.push(below)
      continue
    }
    if (words.length - words.trimStart().length <= item.indent) break

    held.push(...blanks, below)
    blanks = []
  }
  return held
}

/** A line moved in or out by some spaces, past its quote marks. */
function shifted(line: Line, by: number): ChangeSpec[] {
  const quote = quoteOf(line.text)
  const words = line.text.slice(quote)
  if (!words.trim() || by === 0) return []
  if (by > 0) return [{ from: line.from + quote, insert: ' '.repeat(by) }]

  const blanks = words.length - words.trimStart().length
  return [{ from: line.from + quote, to: line.from + quote + Math.min(-by, blanks) }]
}

/** A command's walk over its lines, with what has been counted so far: each item placed
 *  by `to`, what hangs from it after it, and any other line by the step of the item
 *  before it. */
function placeLines(
  state: EditorState,
  to: (line: Line, item: Item) => number,
  other: (line: Line, step: number) => ChangeSpec[],
): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  const counted = new Map<number, number>()
  const done = new Set<number>()
  let step = state.facet(indentUnit).length

  for (const line of selectedLines(state)) {
    if (done.has(line.number)) continue

    const item = inCode(state, line.from) ? null : itemOf(line.text)
    if (!item) {
      changes.push(...other(line, step))
      continue
    }

    const landing = to(line, item)
    step = Math.abs(landing - item.indent)
    changes.push(...shifted(line, landing - item.indent))

    // A number kept would say the wrong thing: `2.` as the first of a new list starts it
    // at two, the way Obsidian and Typora don't. Where nothing stands above, it stays.
    let wider = 0
    if (item.number !== null && landing !== item.indent) {
      const above = itemAbove(state, line.number, landing)
      const number =
        counted.get(landing) ??
        (above?.indent === landing && above.number !== null ? above.number : above ? 0 : null)
      if (number !== null || counted.has(landing)) {
        const next = String((number ?? 0) + 1)
        counted.set(landing, Number(next))
        wider = next.length - item.digits
        const from = line.from + item.quote + item.indent
        changes.push({ from, to: from + item.digits, insert: next })
      }
    }

    for (const held of hanging(state, line, item)) {
      done.add(held.number)
      changes.push(...shifted(held, landing - item.indent + wider))
    }
  }

  return changes
}

function dispatched(
  { state, dispatch }: Parameters<StateCommand>[0],
  changes: ChangeSpec[],
  userEvent: string,
): boolean {
  const set = state.changes(changes)
  dispatch(state.update({ changes: set, selection: state.selection.map(set, 1), userEvent }))
  return true
}

/** One step in by the key: a list item as far as the words of the item above it, which
 *  is what nests it, and its children with it. Two spaces under `1. ` are not enough,
 *  and the list stays flat with a stray indent. Everything else is the library's. */
export const indentItems: StateCommand = (target) => {
  const { state } = target
  if (!itemLines(state)) return indentMore(target)
  if (state.readOnly) return false

  const unit = state.facet(indentUnit).length
  const changes = placeLines(
    state,
    (line, item) => {
      const above = itemAbove(state, line.number, item.indent)
      return above?.indent === item.indent ? above.column : item.indent + unit
    },
    (line, step) => shifted(line, step),
  )
  return dispatched(target, changes, 'input.indent')
}

/** One step back out, to where the item it is nested in stands. */
export const outdentItems: StateCommand = (target) => {
  const { state } = target
  if (!itemLines(state)) return indentLess(target)
  if (state.readOnly) return false

  const unit = state.facet(indentUnit).length
  const changes = placeLines(
    state,
    (line, item) => {
      const above = item.indent > 0 ? itemAbove(state, line.number, item.indent - 1) : null
      return above ? above.indent : Math.max(0, item.indent - unit)
    },
    (line, step) => shifted(line, -step),
  )
  return dispatched(target, changes, 'delete.dedent')
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

    // A line left beside the table's new place: over its head it is no table, and under
    // its last row it is a row. A blank line stays there too.
    const doc = state.doc
    const before = first.number > 1 && doc.line(first.number - 1).text.trim() !== ''
    const after = last.number < doc.lines && doc.line(last.number + 1).text.trim() !== ''
    const moved = doc.sliceString(first.from, last.to)
    const held = doc.sliceString(table.from, table.to)
    const from = delta < 0 ? table.from : first.from
    const to = delta < 0 ? last.to : table.to
    const over = delta > 0 && before ? '\n' : ''
    const under = delta < 0 && after ? '\n' : ''
    const shift = delta < 0 ? table.from - first.from : over.length + held.length + 2
    dispatch(
      state.update({
        changes: {
          from,
          to,
          insert: delta < 0 ? `${moved}\n\n${held}${under}` : `${over}${held}\n\n${moved}`,
        },
        selection: EditorSelection.range(range.anchor + shift, range.head + shift),
        scrollIntoView: true,
        userEvent: 'move.line',
      }),
    )
    return true
  }
}
