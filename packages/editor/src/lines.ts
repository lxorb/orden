import { syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  findClusterBreak,
  type Line,
  type StateCommand,
} from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { verbatimBlockAt } from './code'
import { type Lines, linesOf } from './commands'
import { frontMatterSpan } from './live-preview/front-matter'

function firstOfBody(state: EditorState, number: number): number {
  const front = frontMatterSpan(state)
  const below = front ? state.doc.lineAt(front.after).number : 1
  return number >= below ? below : 1
}

const blank = (line: Line) => line.text.trim() === ''

interface Run extends Lines {
  items?: readonly Lines[]
  ordered?: boolean
}

const LISTS = new Set(['BulletList', 'OrderedList'])

function listAround(state: EditorState, line: Line): Run | null {
  const doc = state.doc
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); node; node = node.parent) {
    const list = node.parent
    if (node.name !== 'ListItem' || !list || !LISTS.has(list.name)) continue

    const items = list.getChildren('ListItem').map((item) => ({
      first: doc.lineAt(item.from).number,
      last: doc.lineAt(item.to).number,
    }))
    const first = items[0]?.first ?? line.number
    const last = items.at(-1)?.last ?? line.number
    return { first, last, items, ordered: list.name === 'OrderedList' }
  }
  return null
}

function rowsOf(state: EditorState, block: SyntaxNode): Lines | null {
  const lineOf = (pos: number) => state.doc.lineAt(pos).number
  if (block.name === 'FencedCode') {
    const close = block.getChildren('CodeMark')[1]
    return {
      first: lineOf(block.from) + 1,
      last: close ? lineOf(close.from) - 1 : lineOf(block.to),
    }
  }
  if (block.name === 'Table') {
    const rows = block.getChildren('TableRow')
    const [top, bottom] = [rows[0], rows.at(-1)]
    return top && bottom ? { first: lineOf(top.from), last: lineOf(bottom.from) } : null
  }
  const last = lineOf(Math.max(block.from, block.to - 1))
  if (block.name === 'CodeBlock') return { first: lineOf(block.from), last }
  return { first: lineOf(block.from) + 1, last: last - 1 }
}

function verbatimRows(state: EditorState, line: Line): Lines | null {
  const block = verbatimBlockAt(state, line)
  if (!block) return null

  const rows = rowsOf(state, block)
  return rows && rows.first <= line.number && line.number <= rows.last
    ? rows
    : { first: line.number, last: line.number }
}

const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/

function yamlLevel(text: string): number {
  const indent = /^[ \t]*/.exec(text)?.[0].length ?? 0
  return indent + (/^-(?:[ \t]|$)/.test(text.slice(indent)) ? 1 : 0)
}

function propertyRun(state: EditorState, number: number, rows: Lines): Run {
  const doc = state.doc
  const level = yamlLevel(doc.line(number).text)
  const within = (at: number) => {
    const text = doc.line(at).text
    return text.trim() === '' || yamlLevel(text) >= level
  }
  let first = number
  let last = number
  while (first > rows.first && within(first - 1)) first--
  while (last < rows.last && within(last + 1)) last++

  const items: Lines[] = []
  for (let at = first; at <= last; at++) {
    const text = doc.line(at).text
    const previous = items.at(-1)
    const starts = text.trim() !== '' && yamlLevel(text) === level
    if (previous && !starts) previous.last = at
    else items.push({ first: at, last: at })
  }
  return { first, last, items }
}

function runAround(state: EditorState, number: number): Run {
  const doc = state.doc
  const line = doc.line(number)
  const verbatim = verbatimRows(state, line)
  if (verbatim && !blank(line) && verbatimBlockAt(state, line)?.name === 'FrontMatter') {
    return propertyRun(state, number, verbatim)
  }
  const list = verbatim || blank(line) ? null : listAround(state, line)
  if (list) return list
  if (!verbatim && HEADING_LINE.test(line.text)) return { first: number, last: number }

  const { first: top, last: bottom } = verbatim ?? {
    first: firstOfBody(state, number),
    last: doc.lines,
  }
  const joins = (other: Line) =>
    !blank(other) &&
    (verbatim !== null ||
      (verbatimBlockAt(state, other) === null && !HEADING_LINE.test(other.text) && listAround(state, other) === null))
  let first = number
  let last = number
  while (first > top && joins(doc.line(first - 1))) first--
  while (last < bottom && joins(doc.line(last + 1))) last++
  return { first, last }
}

function propertiesIn(state: EditorState, lines: Lines, rows: Lines): Run {
  let anchor = lines.first
  for (let at = lines.first; at <= lines.last; at++) {
    const text = state.doc.line(at).text
    if (text.trim() !== '' && yamlLevel(text) < yamlLevel(state.doc.line(anchor).text)) anchor = at
  }
  const run = propertyRun(state, anchor, rows)
  const items = (run.items ?? []).filter((item) => item.last >= lines.first && item.first <= lines.last)
  const [top, bottom] = [items[0], items.at(-1)]
  if (!top || !bottom || lines.last > run.last) return lines
  return { first: top.first, last: bottom.last, items }
}

function itemsIn(state: EditorState, lines: Lines): Run {
  const line = state.doc.line(lines.first)
  const rows = verbatimRows(state, line)
  if (rows && verbatimBlockAt(state, line)?.name === 'FrontMatter' && lines.last <= rows.last) {
    return propertiesIn(state, lines, rows)
  }
  const list = verbatimRows(state, line) || blank(line) ? null : listAround(state, line)
  if (!list?.items || lines.last > list.last) return lines
  const items = list.items.filter((item) => item.last >= lines.first && item.first <= lines.last)
  const [top, bottom] = [items[0], items.at(-1)]
  if (!top || !bottom || items.length < 2) return lines
  return { first: top.first, last: bottom.last, items, ordered: list.ordered ?? false }
}

function blocksOf(state: EditorState, around: boolean): Run[] {
  const found: Run[] = state.selection.ranges
    .map((range) => {
      const lines = linesOf(state, range.from, range.to)
      if (!around) return lines
      return lines.first === lines.last ? runAround(state, lines.first) : itemsIn(state, lines)
    })
    .sort((one, other) => one.first - other.first)

  const merged: Run[] = []
  for (const lines of found) {
    const previous = merged.at(-1)
    if (previous && lines.first <= previous.last) {
      if (lines.first !== previous.first || lines.last !== previous.last) delete previous.items
      previous.last = Math.max(previous.last, lines.last)
    } else {
      merged.push({ ...lines })
    }
  }
  return merged
}

const LEAD = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

let collator: Intl.Collator | null = null

function compare(one: string, other: string): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(one.replace(LEAD, ''), other.replace(LEAD, ''))
}

const ORDINAL = /^([ \t]*(?:>[ \t]?)*[ \t]*)(\d+)(?=[.)])/

const UNDER = /^(?:[ \t]*>[ \t]?)*[ \t]*/

function shiftedUnder(line: string, past: number, shift: number): string {
  const prefix = UNDER.exec(line)?.[0] ?? ''
  if (prefix.length <= past || prefix.length === line.length) return line
  if (shift > 0) return prefix + ' '.repeat(shift) + line.slice(prefix.length)
  const spaces = / *$/.exec(prefix)?.[0].length ?? 0
  return prefix.slice(0, prefix.length - Math.min(spaces, -shift)) + line.slice(prefix.length)
}

function renumbered(items: readonly string[], start: number): string[] {
  return items.map((item, i) => {
    const found = ORDINAL.exec(item)
    if (!found) return item
    const [written, lead = '', digits = ''] = found
    const number = String(start + i)
    const shift = number.length - digits.length
    const [head = '', ...under] = (lead + number + item.slice(written.length)).split('\n')
    return [head, ...under.map((line) => shiftedUnder(line, lead.length, shift))].join('\n')
  })
}

function entriesOf(run: Run): readonly Lines[] {
  if (run.items) return run.items
  return Array.from({ length: run.last - run.first + 1 }, (_, i) => ({
    first: run.first + i,
    last: run.first + i,
  }))
}

function reordered(reorder: (lines: string[]) => string[]): StateCommand {
  return ({ state, dispatch }) => {
    const doc = state.doc
    const text = (from: number, to: number) => state.sliceDoc(doc.line(from).from, doc.line(to).to)
    const blocks = blocksOf(state, true)
      .map((run) => ({ run, entries: entriesOf(run) }))
      .filter(({ entries }) => entries.length > 1)
    if (!blocks.length) return false

    const changes: ChangeSpec[] = []
    const ranges = blocks.map(({ run, entries }) => {
      const from = doc.line(run.first).from
      const to = doc.line(run.last).to
      const items = entries.map(({ first, last }) => text(first, last))
      const gapBefore = (i: number) => {
        const before = entries[i - 1]
        const entry = entries[i]
        return before && entry ? state.sliceDoc(doc.line(before.last).to, doc.line(entry.first).from) : ''
      }
      const start = Number(ORDINAL.exec(items[0] ?? '')?.[2] ?? 1)
      const order = run.ordered ? renumbered(reorder(items), start) : reorder(items)

      changes.push({ from, to, insert: order.map((item, i) => gapBefore(i) + item).join('') })
      return EditorSelection.range(from, to)
    })

    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(ranges),
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const sortLines = reordered((lines) => [...lines].sort(compare))
export const reverseLines = reordered((lines) => [...lines].reverse())

export const deleteLine: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const { head } = state.selection.main
  const column = head - doc.lineAt(head).from
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    const from = last < doc.lines ? doc.line(first).from : Math.max(0, doc.line(first).from - 1)
    const to = last < doc.lines ? doc.line(last + 1).from : doc.line(last).to
    changes.push({ from, to })
    carets.push(from)
  }

  const set = state.changes(changes)
  const after = set.apply(doc)
  const ranges = carets.map((at) => {
    const line = after.lineAt(set.mapPos(at, 1))
    const along = findClusterBreak(line.text, Math.min(column, line.length) + 1, false)
    return EditorSelection.cursor(line.from + along)
  })

  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.create(ranges),
      scrollIntoView: true,
      userEvent: 'delete.line',
    }),
  )
  return true
}

const MARKERS = new Set(['QuoteMark', 'ListMark', 'TaskMarker', 'HeaderMark'])

function leadOf(state: EditorState, line: Line): number {
  const tree = syntaxTree(state)
  let at = line.from
  for (;;) {
    at += /^[ \t]*/.exec(state.sliceDoc(at, line.to))?.[0].length ?? 0
    const mark = tree.resolveInner(at, 1)
    if (at >= line.to || mark.from !== at || !MARKERS.has(mark.name)) return at - line.from
    at = mark.to
  }
}

export const joinLines: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc
  const changes: ChangeSpec[] = []
  const carets: number[] = []

  for (const { first, last } of blocksOf(state, false)) {
    const end = first === last ? Math.min(last + 1, doc.lines) : last
    for (let number = first; number < end; number++) {
      const line = doc.line(number)
      const next = doc.line(number + 1)
      const lead = leadOf(state, next)
      const spaced = /\s$/.test(line.text) || next.text.length === lead || !line.text ? '' : ' '
      changes.push({ from: line.to, to: next.from + lead, insert: spaced })
      carets.push(line.to)
    }
  }
  if (!changes.length) return false

  const set = state.changes(changes)
  dispatch(
    state.update({
      changes: set,
      selection: EditorSelection.create(
        state.selection.ranges.length > 1 || !state.selection.main.empty
          ? state.selection.ranges.map((range) => range.map(set))
          : [EditorSelection.cursor(set.mapPos(carets.at(-1) ?? 0, 1))],
      ),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? ''
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}
