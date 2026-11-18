import { indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands'
import { foldEffect, foldedRanges, indentUnit, syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Line,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { ownLine } from '@orden/markdown/links'
import { ownIdEnd } from './block/span'
import { inCode } from './code'
import { selectedLines } from './commands'
import { enclosingNamed } from './nodes'

const AN_ITEM = /^((?:[ \t]*>)+[ \t]?|)([ \t]*)(?:(\d+)([.)])|([-*+]))( +)/u

const TAB_STOP = 4

const QUOTE_MARK = /^[ \t]*>[ \t]?/u

interface Item {
  quote: number
  indent: number
  lead: number
  tabs: boolean
  column: number
  number: number | null
  digits: number
}

function columnsOf(lead: string): number {
  let columns = 0
  for (const one of lead)
    columns = one === '\t' ? columns + TAB_STOP - (columns % TAB_STOP) : columns + 1
  return columns
}

function itemOf(text: string): Item | null {
  const found = AN_ITEM.exec(text)
  if (!found) return null

  const quote = found[1]?.length ?? 0
  const lead = found[2] ?? ''
  const indent = columnsOf(lead)
  return {
    quote,
    indent,
    lead: lead.length,
    tabs: lead.includes('\t'),
    column: indent + found[0].length - quote - lead.length,
    number: found[3] === undefined ? null : Number(found[3]),
    digits: found[3]?.length ?? 0,
  }
}

function quoteOf(text: string, marks = Infinity): number | null {
  let at = 0
  for (let left = marks; left > 0; left--) {
    const mark = QUOTE_MARK.exec(text.slice(at))
    if (!mark) return marks === Infinity ? at : null
    at += mark[0].length
  }
  return at
}

function marksOf(item: Item, line: Line): number {
  return line.text.slice(0, item.quote).split('>').length - 1
}

function itemAbove(state: EditorState, number: number, depth: number): Item | null {
  for (let at = number - 1; at >= 1; at--) {
    const text = state.doc.line(at).text
    const words = text.slice(quoteOf(text) ?? 0)
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
  const marks = marksOf(item, line)
  for (let at = line.number + 1; at <= state.doc.lines; at++) {
    const below = state.doc.line(at)
    const quote = quoteOf(below.text, marks)
    if (quote === null) break
    const words = below.text.slice(quote)
    if (!words.trim()) {
      blanks.push(below)
      continue
    }
    if (columnsOf(words.slice(0, words.length - words.trimStart().length)) <= item.indent) break

    held.push(...blanks, below)
    blanks = []
  }
  return held
}

function shifted(line: Line, by: number, marks = Infinity, tabs = false): ChangeSpec[] {
  const quote = quoteOf(line.text, marks) ?? 0
  const words = line.text.slice(quote)
  if (!words.trim() || by === 0) return []

  const blanks = words.length - words.trimStart().length
  const lead = words.slice(0, blanks)
  if (tabs || lead.includes('\t')) {
    const wanted = Math.max(0, columnsOf(lead) + by)
    const insert = '\t'.repeat(Math.floor(wanted / TAB_STOP)) + ' '.repeat(wanted % TAB_STOP)
    return [{ from: line.from + quote, to: line.from + quote + blanks, insert }]
  }
  if (by > 0) return [{ from: line.from + quote, insert: ' '.repeat(by) }]

  return [{ from: line.from + quote, to: line.from + quote + Math.min(-by, blanks) }]
}

function tabbed(landing: number, item: Item, up: boolean): number {
  if (!item.tabs) return landing
  return (up ? Math.ceil(landing / TAB_STOP) : Math.floor(landing / TAB_STOP)) * TAB_STOP
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
    changes.push(...shifted(line, landing - item.indent, Infinity, item.tabs))

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
        const from = line.from + item.quote + item.lead
        changes.push({ from, to: from + item.digits, insert: next })
      }
    }

    for (const held of hanging(state, line, item)) {
      done.add(held.number)
      changes.push(...shifted(held, landing - item.indent + wider, marksOf(item, line), item.tabs))
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
    const step = item.tabs ? TAB_STOP : unit
    return tabbed(above?.indent === item.indent ? above.column : item.indent + step, item, true)
  },
  shifted,
  'input.indent',
)

export const outdentItems: StateCommand = placing(
  indentLess,
  (state, line, item, unit) => {
    const above = item.indent > 0 ? itemAbove(state, line.number, item.indent - 1) : null
    const step = item.tabs ? TAB_STOP : unit
    return above ? above.indent : tabbed(Math.max(0, item.indent - step), item, false)
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
  if (delta < 0 && inDoc(near) && ownLine(doc.line(near).text)) {
    near += delta
    if (inDoc(near) && !doc.line(near).text.trim()) near += delta
  }
  if (!inDoc(near)) return null

  const table = tableAt(state, doc.line(near).from)
  return table && { from: table.from, to: ownIdEnd(doc, table.to) }
}

function tableAt(state: EditorState, at: number): { from: number; to: number } | null {
  return enclosingNamed(syntaxTree(state).resolveInner(at, 1), 'Table')
}

interface Span {
  from: number
  to: number
}

function foldsBetween(state: EditorState, from: number, to: number): Span[] {
  const found: Span[] = []
  foldedRanges(state).between(from, to, (start, end) => {
    if (start >= from && end <= to) found.push({ from: start, to: end })
  })
  return found
}

function withHidden(state: EditorState, line: Line): Line {
  let last = line
  for (const fold of foldsBetween(state, last.from, state.doc.length)) {
    if (fold.from <= last.to) last = state.doc.lineAt(fold.to)
  }
  return last
}

function heldAbove(state: EditorState, line: Line): Line {
  let first = line
  foldedRanges(state).between(line.from, line.from, (start, end) => {
    if (start < line.from && end >= line.from) first = state.doc.lineAt(start)
  })
  return first
}

function movedWithFolds(
  target: { state: EditorState; dispatch: (transaction: Transaction) => void },
  first: Line,
  bottom: Line,
  delta: -1 | 1,
): boolean {
  const { state } = target
  const { doc } = state
  const last = withHidden(state, bottom)
  const near = delta < 0 ? first.number - 1 : last.number + 1
  if (near < 1 || near > doc.lines) return last.number !== bottom.number

  const nearLine = doc.line(near)
  const other =
    delta < 0
      ? { from: heldAbove(state, nearLine).from, to: nearLine.to }
      : { from: nearLine.from, to: withHidden(state, nearLine).to }
  const moving = { from: first.from, to: last.to }
  if (
    !foldsBetween(state, Math.min(moving.from, other.from), Math.max(moving.to, other.to)).length
  ) {
    return false
  }

  const [top, under] = delta < 0 ? [other, moving] : [moving, other]
  const upper = doc.sliceString(top.from, top.to)
  const lower = doc.sliceString(under.from, under.to)
  const rises = under.from - top.from
  const sinks = lower.length + 1
  const shifted = (span: Span, by: number) =>
    foldEffect.of({ from: span.from + by, to: span.to + by })
  const range = state.selection.main
  const shift = delta < 0 ? -rises : sinks

  target.dispatch(
    state.update({
      changes: { from: top.from, to: under.to, insert: `${lower}\n${upper}` },
      selection: EditorSelection.range(range.anchor + shift, range.head + shift),
      effects: [
        ...foldsBetween(state, top.from, top.to).map((span) => shifted(span, sinks)),
        ...foldsBetween(state, under.from, under.to).map((span) => shifted(span, -rises)),
      ],
      scrollIntoView: true,
      userEvent: 'move.line',
    }),
  )
  return true
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
    if (state.readOnly) return library(target)
    if (!table && !inside) return movedWithFolds(target, first, last, delta) || library(target)
    if (!table || inside) return library(target)

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
