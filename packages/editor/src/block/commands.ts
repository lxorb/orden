import type { ChangeSpec, EditorState, StateCommand } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Command, EditorView } from '@codemirror/view'
import { blockIdOf, freeBlockId, blockIds, ownLine, rowsOf } from '@orden/markdown/links'
import { indentItems, outdentItems } from '../list-keys'
import { headingLevel, headingText } from '../headings'
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

export function duplicateBlocks(view: EditorView, pos: number): boolean {
  const spans = blocksFor(view, pos)
  if (!spans.length) return false

  const changes: ChangeSpec[] = []
  let caret: number | null = null

  for (const span of [...spans].reverse()) {
    const edit = copyBlock(view.state, span)
    changes.push(...edit.changes)
    caret ??= edit.caret
  }

  view.dispatch({
    changes,
    ...(caret === null ? {} : { selection: { anchor: caret } }),
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
    const insert = `\n\n^${id}${below ? '\n' : ''}`
    view.dispatch({ changes: { from: last.to, to: last.to, insert } })
    return `#^${id}`
  }

  const end = last.from + last.text.trimEnd().length
  view.dispatch({ changes: { from: end, to: end, insert: ` ^${id}` } })
  return `#^${id}`
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

function numberedLine(text: string, counting: Counting[]): string {
  const { indent, words } = wordsOf(text)
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
  return ' '.repeat(level.at) + mark + words
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

    for (let number = first; number <= last; number++) {
      if (verbatim.has(number) || seen.has(number)) continue
      seen.add(number)
      const line = doc.line(number)
      if (!wordsOf(line.text).words.trim()) continue

      const into: BlockShape = heading && number > first ? 'paragraph' : shape
      const text =
        into === 'numbered' ? numberedLine(line.text, counting) : shaped(line.text, into, nth)
      if (into === 'numbered') nth++
      if (text === line.text) continue

      changes.push({ from: line.from, to: line.to, insert: text })
    }
  }

  if (!changes.length) return false

  view.dispatch({ changes, userEvent: 'input' })
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
  return at === null ? null : blockAt(state, at)
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
