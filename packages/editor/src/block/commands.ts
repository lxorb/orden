import type { ChangeSpec, EditorState, Line, StateCommand } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Command, EditorView } from '@codemirror/view'
import { blockIdOf, freeBlockId, blockIds, ownLine, rowsOf } from '@orden/markdown/links'
import { indentItems, outdentItems } from '../list-keys'
import { headingLevel, headingText } from '../headings'
import { landInWords } from '../live-preview/item-start'
import { enclosing } from '../nodes'
import { copyBlock, cutBlock, moveBlock } from './move'
import { verbatimLines } from './verbatim'
import { type BlockShape, shaped, wordsOf } from './shape'
import { blockAt, type BlockKind, blocksIn, type BlockSpan, writtenLine } from './span'

export function blocksFor(view: EditorView, pos: number): BlockSpan[] {
  const range = view.state.selection.main
  const pressed = blockAt(view.state, pos)

  if (range.empty || pos < range.from || pos > range.to) return pressed ? [pressed] : []

  const covered = blocksIn(view.state, range.from, range.to).filter(
    (span) => span.to >= range.from && span.from <= range.to,
  )

  return covered.length ? covered : pressed ? [pressed] : []
}

function runOf(spans: BlockSpan[]): BlockSpan | null {
  const first = spans[0]
  if (!first) return null

  const to = spans.reduce((most, span) => Math.max(most, span.to), first.to)
  return { from: first.from, to, kind: first.kind }
}

function outermost(spans: readonly BlockSpan[]): BlockSpan[] {
  const kept: BlockSpan[] = []
  for (const span of spans) {
    const holder = kept.at(-1)
    if (holder && span.from >= holder.from && span.to <= holder.to) continue
    kept.push(span)
  }
  return kept
}

export function duplicateBlocks(view: EditorView, pos: number): boolean {
  const spans = outermost(blocksFor(view, pos))
  const last = spans.at(-1)
  if (!last) return false

  const changes = view.state.changes(spans.flatMap((span) => copyBlock(view.state, span).changes))
  const caret = copyBlock(view.state, last).caret
  const lastCopy = { from: 0, fromB: 0 }
  changes.iterChanges((from, _to, fromB) => Object.assign(lastCopy, { from, fromB }))
  const landing = caret === null ? null : lastCopy.fromB + caret - lastCopy.from

  view.dispatch({
    changes,
    ...(landing === null ? {} : { selection: { anchor: landing } }),
    annotations: landInWords.of(true),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

export function deleteBlocks(view: EditorView, pos: number): boolean {
  const run = runOf(blocksFor(view, pos))
  if (!run) return false

  const cut = cutBlock(view.state, run)

  view.dispatch({
    changes: cut.changes,
    selection: { anchor: cut.caret ?? run.from },
    annotations: landInWords.of(true),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

const atCaret =
  (act: (view: EditorView, pos: number) => boolean): Command =>
  (view) =>
    !view.state.readOnly && act(view, view.state.selection.main.head)

export const duplicateBlock = atCaret(duplicateBlocks)
export const moveBlockUp = atCaret((view, pos) => moveBlocks(view, pos, -1))
export const moveBlockDown = atCaret((view, pos) => moveBlocks(view, pos, 1))

export function blockTarget(view: EditorView, pos: number): string | null {
  const span = blockAt(view.state, pos)
  if (!span) return null

  const doc = view.state.doc
  const first = doc.lineAt(span.from)

  if (span.kind === 'heading') {
    const words = headingText(first.text)
    return words ? `#${words}` : null
  }

  if (span.kind === 'front-matter') return null

  const rows = rowsOf(doc.toString())
  const verbatim = verbatimLines(view.state, span.from, span.to)
  if (rows[first.number - 1]?.code) {
    for (let at = first.number - 1; rows[at]?.code; at++) {
      const old = rows[at]?.fenceName
      if (old) return `#^${old}`
    }
    if (!verbatim.has(first.number)) return null
  }

  const last = doc.lineAt(ownEnd(view.state, span))
  const under = writtenLine(view.state, last.number + 1, 1)
  const already =
    under && ownLine(under.text)
      ? blockIdOf(under.text)
      : span.kind !== 'code' && blockIdOf(last.text)
  if (already) return `#^${already}`

  const taken = new Set(blockIds(doc.toString()).map((one) => one.id))
  const id = freeBlockId(taken)

  if (verbatim.has(last.number)) {
    const below = last.number < doc.lines ? doc.line(last.number + 1).text.trim() : ''
    const insert = `\n\n${itemIndent(view.state, span, last)}^${id}${below ? '\n' : ''}`
    view.dispatch({ changes: { from: last.to, to: last.to, insert } })
    return `#^${id}`
  }

  const end = last.from + last.text.trimEnd().length
  view.dispatch({ changes: { from: end, to: end, insert: ` ^${id}` } })
  return `#^${id}`
}

function itemIndent(state: EditorState, span: BlockSpan, last: Line): string {
  const item = [...enclosing(syntaxTree(state).resolveInner(last.to, -1))].find(
    (node) => node.name === 'ListItem' && state.doc.lineAt(node.from).from <= span.from,
  )
  if (!item) return ''

  const line = state.doc.lineAt(item.from)
  const marked = (item.getChild('ListMark')?.to ?? item.from) - line.from
  const space = INDENT.exec(line.text.slice(marked))?.[0].length ?? 0
  const column = marked + (space >= 1 && space <= 4 ? space : 1)
  return INDENT.exec(last.text.slice(0, column))?.[0] ?? ''
}

function ownEnd(state: EditorState, span: BlockSpan): number {
  if (span.kind !== 'list') return span.to

  const first = state.doc.lineAt(span.from)
  const inner = blocksIn(state, Math.min(first.to + 1, span.to), span.to).find(
    (one) => one.from > first.to,
  )
  if (!inner) return span.to

  const before = writtenLine(state, state.doc.lineAt(inner.from).number - 1, -1)
  return before ? before.to : span.to
}

const PROSE = new Set<BlockKind>(['heading', 'paragraph', 'list', 'quote'])

interface Counting {
  written: number
  at: number
  column: number
  nth: number
}

function startsAnItem(state: EditorState, line: Line): boolean {
  let found = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (found) return false
      if (node.name === 'ListMark' && node.from >= line.from && node.from <= line.to) found = true
      return !found
    },
  })
  return found
}

function numberedLine(
  text: string,
  counting: Counting[],
  listed: boolean,
  quoted: boolean,
): string {
  const { lead, indent, words } = wordsOf(text, listed, quoted)
  const written = indent.length

  while (counting.length > 1 && (counting.at(-1)?.written ?? 0) > written) counting.pop()
  let level = counting.at(-1)
  if (!level || level.written < written) {
    level = { written, at: level ? level.column : written, column: 0, nth: 1 }
    counting.push(level)
  }

  const mark = `${level.nth}. `
  level.nth++
  level.column = level.at + mark.length
  return lead + ' '.repeat(level.at) + mark + words
}

const LISTED = new Set<BlockShape>(['bullet', 'numbered', 'task'])

const INDENT = /^[ \t]*/

const BARE_QUOTE = /^[ \t]*(?:>[ \t]*)+$/

const QUOTE_MARKS = /^(?:[ \t]*>)*/

const LINE_LEAD = /^(?:[ \t]*>)*[ \t]*/

const ITEM_CONTENT = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?/

const contentColumn = (text: string) => ITEM_CONTENT.exec(text)?.[0].length ?? 0

function itemsHolding(state: EditorState, line: Line): number[] {
  const at = line.from + (LINE_LEAD.exec(line.text)?.[0].length ?? 0)
  return [...enclosing(syntaxTree(state).resolveInner(at, 1))]
    .filter((node) => node.name === 'ListItem')
    .map((node) => state.doc.lineAt(node.from).number)
}

function shiftedIn(text: string, shift: number, holder: string): string {
  const quote = holder.length && text.startsWith(holder) ? holder.length : 0
  const indent = text.slice(0, quote + (INDENT.exec(text.slice(quote))?.[0].length ?? 0))
  if (shift > 0) return indent + ' '.repeat(shift) + text.slice(indent.length)
  const spaces = / *$/.exec(indent)?.[0].length ?? 0
  return indent.slice(0, indent.length - Math.min(spaces, -shift)) + text.slice(indent.length)
}

export function turnBlocksInto(view: EditorView, pos: number, shape: BlockShape): boolean {
  const spans = blocksFor(view, pos).filter((span) => PROSE.has(span.kind))
  if (!spans.length) return false

  const doc = view.state.doc
  const changes: ChangeSpec[] = []
  const heading = shape.startsWith('heading')
  const counting: Counting[] = []
  const seen = new Set<number>()
  let nth = 1

  for (const span of spans) {
    const first = doc.lineAt(span.from).number
    const last = span.kind !== 'heading' ? doc.lineAt(Math.min(span.to, doc.length)).number : first
    const verbatim = verbatimLines(view.state, span.from, doc.line(last).to)
    const itemwise = span.kind === 'list' || (LISTED.has(shape) && span.kind !== 'quote')
    const quoted = span.kind !== 'quote'
    const shifts = new Map<number, number>()

    for (let number = first; number <= last; number++) {
      if (seen.has(number)) continue
      seen.add(number)
      const line = doc.line(number)
      if (!line.text.trim()) continue

      const items = itemwise && number > first ? itemsHolding(view.state, line) : [number]
      if (items[0] !== number || (itemwise && number > first && !LISTED.has(shape))) {
        const owner = items.find((item) => shifts.has(item)) ?? first
        const holder = QUOTE_MARKS.exec(doc.line(owner).text)?.[0] ?? ''
        const text = shiftedIn(line.text, shifts.get(owner) ?? 0, holder)
        if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text })
        continue
      }

      const listed = startsAnItem(view.state, line)
      if (verbatim.has(number)) continue
      if (!wordsOf(line.text, listed, quoted).words.trim()) {
        if (!quoted && shape !== 'quote' && BARE_QUOTE.test(line.text)) {
          changes.push({ from: line.from, to: line.to, insert: '' })
        }
        continue
      }

      const into: BlockShape = heading && number > first ? 'paragraph' : shape
      const text =
        into === 'numbered'
          ? numberedLine(line.text, counting, listed, quoted)
          : shaped(line.text, into, nth, listed, quoted)
      if (into === 'numbered') nth++
      if (itemwise) shifts.set(number, contentColumn(text) - contentColumn(line.text))
      if (text === line.text) continue

      changes.push({ from: line.from, to: line.to, insert: text })
    }
  }

  if (!changes.length) return false

  view.dispatch({ changes, userEvent: 'input', annotations: landInWords.of(true) })
  view.focus()
  return true
}

function overBlocks(view: EditorView, pos: number, command: StateCommand): boolean {
  const spans = blocksFor(view, pos)
  const first = spans[0]
  const last = spans.at(-1)
  if (!first || !last) return false

  view.dispatch({
    selection: { anchor: first.from, head: Math.min(last.to, view.state.doc.length) },
  })

  const ran = command({
    state: view.state,
    dispatch: (transaction) => view.dispatch(transaction),
  })
  view.focus()
  return ran
}

export function indentBlocks(view: EditorView, pos: number): boolean {
  return overBlocks(view, pos, indentItems)
}

export function outdentBlocks(view: EditorView, pos: number): boolean {
  return overBlocks(view, pos, outdentItems)
}

function nextWritten(state: EditorState, from: number, delta: -1 | 1): number | null {
  const doc = state.doc
  const line = doc.lineAt(Math.max(0, Math.min(from, doc.length)))
  return writtenLine(state, line.number + delta, delta)?.from ?? null
}

function beside(state: EditorState, run: BlockSpan, delta: -1 | 1): BlockSpan | null {
  const at = nextWritten(state, delta < 0 ? run.from : run.to, delta)
  if (at === null) return null
  const text = state.doc.lineAt(at).text
  const lead = /^(?:[ \t]*>)+[ \t]*/.exec(text)?.[0].length ?? 0
  return blockAt(state, lead ? at + lead + 1 : at)
}

function levelAt(state: EditorState, pos: number): number | null {
  const node = syntaxTree(state).resolveInner(pos, 1)
  for (const found of enclosing(node)) {
    const level = headingLevel(found.name)
    if (level !== null) return level
  }

  return null
}

function sectionAbove(state: EditorState, run: BlockSpan): BlockSpan | null {
  const level = levelAt(state, run.from)
  if (level === null) return null

  const found: number[] = []
  syntaxTree(state).iterate({
    to: run.from,
    enter: (node) => {
      if (node.name === 'Document') return true
      const other = headingLevel(node.name)
      if (other !== null && other <= level && node.from < run.from) found.push(node.from)
      return false
    },
  })

  const nearest = found.at(-1)
  return nearest === undefined ? null : blockAt(state, nearest)
}

function landingFor(state: EditorState, run: BlockSpan, delta: -1 | 1): number | null {
  if (delta < 0) {
    const heading = run.kind === 'heading' ? sectionAbove(state, run) : null
    return (heading ?? beside(state, run, -1))?.from ?? null
  }

  const neighbour = beside(state, run, 1)
  if (!neighbour) return null

  const over =
    neighbour.kind === 'heading' && run.kind !== 'heading'
      ? { ...neighbour, to: state.doc.lineAt(neighbour.from).to }
      : neighbour
  const after = beside(state, over, 1)
  return after ? after.from : state.doc.length
}

export function moveBlocks(view: EditorView, pos: number, delta: -1 | 1): boolean {
  const run = runOf(blocksFor(view, pos))
  if (!run) return false

  const at = landingFor(view.state, run, delta)
  if (at === null) return false

  const edit = moveBlock(view.state, run, at)
  if (!edit) return false

  view.dispatch({
    changes: edit.changes,
    ...(edit.caret === null ? {} : { selection: { anchor: edit.caret } }),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

export function blockTargets(view: EditorView, pos: number): string[] {
  const found: string[] = []

  for (const span of [...blocksFor(view, pos)].reverse()) {
    const target = blockTarget(view, span.from)
    if (target) found.unshift(target)
  }

  return found
}
