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

const AN_ITEM = /^((?:[ \t]*>[ \t]?)*)( *)(?:(\d+)([.)])|([-*+]))( +)/u

const QUOTE = /^(?:[ \t]*>[ \t]?)*/u

interface Item {
  quote: number
  indent: number
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

function itemAbove(state: EditorState, number: number, depth: number): Item | null {
  for (let at = number - 1; at >= 1; at--) {
    const text = state.doc.line(at).text
    const words = text.slice(quoteOf(text))
    if (!words.trim()) continue

    const item = itemOf(text)
    if (item && item.indent <= depth) return item
    if (!item && !/^\s/u.test(words)) return null
  }

  return null
}

function itemLines(state: EditorState): boolean {
  return selectedLines(state).some(
    (line) => itemOf(line.text) !== null && !inCode(state, line.from),
  )
}

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

function shifted(line: Line, by: number): ChangeSpec[] {
  const quote = quoteOf(line.text)
  const words = line.text.slice(quote)
  if (!words.trim() || by === 0) return []
  if (by > 0) return [{ from: line.from + quote, insert: ' '.repeat(by) }]

  const blanks = words.length - words.trimStart().length
  return [{ from: line.from + quote, to: line.from + quote + Math.min(-by, blanks) }]
}

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

function placing(
  library: StateCommand,
  to: (state: EditorState, line: Line, item: Item, unit: number) => number,
  other: (line: Line, step: number) => ChangeSpec[],
  userEvent: string,
): StateCommand {
  return (target) => {
    const { state, dispatch } = target
    if (!itemLines(state)) return library(target)
    if (state.readOnly) return false

    const unit = state.facet(indentUnit).length
    const set = state.changes(placeLines(state, (line, item) => to(state, line, item, unit), other))
    dispatch(state.update({ changes: set, selection: state.selection.map(set, 1), userEvent }))
    return true
  }
}

export const indentItems: StateCommand = placing(
  indentMore,
  (state, line, item, unit) => {
    const above = itemAbove(state, line.number, item.indent)
    return above?.indent === item.indent ? above.column : item.indent + unit
  },
  shifted,
  'input.indent',
)

export const outdentItems: StateCommand = placing(
  indentLess,
  (state, line, item, unit) => {
    const above = item.indent > 0 ? itemAbove(state, line.number, item.indent - 1) : null
    return above ? above.indent : Math.max(0, item.indent - unit)
  },
  (line, step) => shifted(line, -step),
  'delete.dedent',
)

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

  return tableAt(state, doc.line(near).from)
}

function tableAt(state: EditorState, at: number): { from: number; to: number } | null {
  return enclosingNamed(syntaxTree(state).resolveInner(at, 1), 'Table')
}

export function moveLineOver(delta: -1 | 1): StateCommand {
  return (target) => {
    const { state, dispatch } = target
    const { doc } = state
    const library = delta < 0 ? moveLineUp : moveLineDown
    const range = state.selection.main
    if (state.selection.ranges.length > 1) return library(target)

    const first = doc.lineAt(range.from)
    const last = doc.lineAt(range.to)
    const table = tableBeside(state, delta < 0 ? first : last, delta)
    const inside = tableAt(state, first.from)
    if (inside?.from !== tableAt(state, last.from)?.from) return true
    if (!table || inside || state.readOnly) return library(target)

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
