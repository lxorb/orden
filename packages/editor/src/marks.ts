import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from '@codemirror/state'
import { type HighlightColour, readHighlight, writeHighlight } from '@orden/markdown/highlights'
import { blockIdOf, ownLine } from '@orden/markdown/links'
import { verbatimLines } from './block/verbatim'
import { inVerbatimBlock } from './code'
import { inside, OPENING } from './commands'

const BLOCKS_APART =
  /\n(?:[ \t]*>)*[ \t]*(?:\n|$|(?:[-*+]|\d+[.)])[ \t]|#{1,6}[ \t])|^(?:[ \t]*>)*[ \t]*#{1,6}[ \t].*\n/u
const QUOTE_DEPTH = /^(?:[ \t]*>)*/
function quoteChanges(text: string): boolean {
  const depths = text.split('\n').map((line) => (QUOTE_DEPTH.exec(line)?.[0] ?? '').replace(/[ \t]/g, ''))
  return depths.some((depth, at) => at > 0 && depth !== depths[at - 1])
}
interface Part {
  from: number
  to: number
}
function partsOf(state: EditorState, from: number, to: number): Part[] {
  const verbatim = verbatimLines(state, from, to)
  const written = state.doc.sliceString(state.doc.lineAt(from).from, to)
  if (!verbatim.size && !BLOCKS_APART.test(written) && !quoteChanges(written)) return [{ from, to }]
  const parts: Part[] = []
  const last = state.doc.lineAt(to).number
  for (let number = state.doc.lineAt(from).number; number <= last; number++) {
    const line = state.doc.line(number)
    if (verbatim.has(number) || inVerbatimBlock(state, line) || ownLine(line.text)) continue
    const id = blockIdOf(line.text)
    const said = id ? line.text.trimEnd().slice(0, -id.length - 1) : line.text
    const start = Math.max(from, line.from + (OPENING.exec(line.text)?.[0].length ?? 0))
    const end = Math.min(to, line.from + said.trimEnd().length)
    if (end > start) parts.push({ from: start, to: end })
  }
  return parts
}
function oddStars(text: string): boolean {
  return text.length % 2 === 1
}
function marksOf(state: EditorState, part: Part, mark: string): Part | null {
  const size = mark.length
  const doc = state.doc
  const line = doc.lineAt(part.from)
  const words = doc.sliceString(part.from, part.to)
  const italic = mark === '*'
  const starsAt = (text: string) => !italic || oddStars(text)
  const inFront = words.startsWith(mark) && starsAt(/^\*+/u.exec(words)?.[0] ?? '')
  const before =
    doc.sliceString(Math.max(0, part.from - size), part.from) === mark &&
    starsAt(/\*+$/u.exec(line.text.slice(0, part.from - line.from))?.[0] ?? '')
  const inBack =
    words.length >= (inFront ? size * 2 : size) && words.endsWith(mark) && starsAt(/\*+$/u.exec(words)?.[0] ?? '')
  const after =
    doc.sliceString(part.to, Math.min(doc.length, part.to + size)) === mark &&
    starsAt(/^\*+/u.exec(doc.sliceString(part.to, doc.lineAt(part.to).to))?.[0] ?? '')
  const open = inFront ? part.from : before ? part.from - size : null
  const close = inBack ? part.to - size : after ? part.to : null
  return open === null || close === null ? null : { from: open, to: close }
}
function wrapEach(
  state: EditorState,
  parts: readonly Part[],
  range: Part,
  mark: string,
  adding: boolean,
): { changes: ChangeSpec[]; range: SelectionRange } {
  const size = mark.length
  const found = adding ? [] : parts.map((part) => marksOf(state, part, mark))
  const marks = found.length && found.every(Boolean) ? (found as Part[]) : null
  const changes = marks
    ? marks.flatMap((one): ChangeSpec[] => [
        { from: one.from, to: one.from + size },
        { from: one.to, to: one.to + size },
      ])
    : parts.flatMap((part, at): ChangeSpec[] =>
        found[at]
          ? []
          : [
              { from: part.from, insert: mark },
              { from: part.to, insert: mark },
            ],
      )
  const set = state.changes(changes)
  return {
    changes,
    range: EditorSelection.range(set.mapPos(range.from, -1), set.mapPos(range.to, 1)),
  }
}
export function marksAcross(mark: string, adding = false): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const held = inside(state, range.from, range.to)
      return wrapEach(state, partsOf(state, held.from, held.to), held, mark, adding)
    })
    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}
const HIGHLIGHT = '=='
function litOf(
  state: EditorState,
  part: Part,
): { from: number; to: number; close: number; colour: HighlightColour } | null {
  const size = HIGHLIGHT.length
  const doc = state.doc
  const words = doc.sliceString(part.from, part.to)
  const line = doc.lineAt(part.from)
  const head = line.text.slice(0, part.from - line.from)
  const mark = head.lastIndexOf(HIGHLIGHT)
  const between = mark < 0 ? '' : head.slice(mark + size)
  const open = words.startsWith(HIGHLIGHT)
    ? part.from
    : mark >= 0 && (!between || readHighlight(`${between}x`).from === between.length)
      ? line.from + mark
      : null
  const close =
    words.endsWith(HIGHLIGHT) && words.length >= (open === part.from ? size * 2 : size)
      ? part.to - size
      : doc.sliceString(part.to, part.to + size) === HIGHLIGHT
        ? part.to
        : null
  if (open === null || close === null) return null
  const read = readHighlight(doc.sliceString(open + size, close))
  return { from: open, to: open + size + read.from, close, colour: read.colour }
}
export function highlightAcross(colour: HighlightColour): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const held = inside(state, range.from, range.to)
      const parts = partsOf(state, held.from, held.to)
      const found = parts.map((part) => litOf(state, part))
      const lit = found.every((one) => one?.colour.emoji === colour.emoji)
      const changes = state.changes(
        parts.flatMap((part, at): ChangeSpec[] => {
          const marks = found[at]
          if (lit && marks) {
            return [
              { from: marks.from, to: marks.to },
              { from: marks.close, to: marks.close + HIGHLIGHT.length },
            ]
          }
          if (marks) {
            if (marks.colour.emoji === colour.emoji) return []
            return [
              {
                from: marks.from + HIGHLIGHT.length,
                to: marks.to,
                insert: writeHighlight('', colour),
              },
            ]
          }
          return [
            { from: part.from, insert: HIGHLIGHT + writeHighlight('', colour) },
            { from: part.to, insert: HIGHLIGHT },
          ]
        }),
      )
      return {
        changes,
        range: EditorSelection.range(changes.mapPos(held.from, -1), changes.mapPos(held.to, 1)),
      }
    })
    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'HighlightMark'])
const RUNS = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight'])
function colourAfter(state: EditorState, mark: SyntaxNode): number {
  const highlight = mark.parent
  if (mark.name !== 'HighlightMark' || highlight?.name !== 'Highlight') return 0
  if (mark.from !== highlight.from) return 0
  return readHighlight(state.doc.sliceString(mark.to, highlight.to - mark.to + mark.from)).from
}
interface Run {
  open: Part
  close: Part
}
function codeRun(state: EditorState, code: SyntaxNode): Run {
  const said = state.doc.sliceString(code.from, code.to)
  const opening = /^`+ ?/u.exec(said)?.[0].length ?? 0
  const closing = / ?`+$/u.exec(said.slice(opening))?.[0].length ?? 0
  return {
    open: { from: code.from, to: code.from + opening },
    close: { from: code.to - closing, to: code.to },
  }
}
function runsOver(state: EditorState, from: number, to: number): Run[] {
  const runs: Run[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.to <= from || node.from >= to) return false
      if (node.name === 'InlineCode') {
        runs.push(codeRun(state, node.node))
        return false
      }
      const open = node.node.firstChild
      const close = node.node.lastChild
      if (RUNS.has(node.name) && open && close && open !== close && MARKS.has(open.name)) {
        runs.push({
          open: { from: open.from, to: open.to + colourAfter(state, open) },
          close: { from: close.from, to: close.to },
        })
      }
      return true
    },
  })
  return runs
}
function clearing(state: EditorState, from: number, to: number): ChangeSpec[] {
  const closings: ChangeSpec[] = []
  const openings: ChangeSpec[] = []
  const taken: ChangeSpec[] = []
  for (const { open, close } of runsOver(state, from, to)) {
    const before = open.to + state.sliceDoc(open.to, Math.max(open.to, from)).trimEnd().length
    const after = close.from - state.sliceDoc(Math.min(to, close.from), close.from).trimStart().length
    if (before > open.to) closings.unshift({ from: before, insert: state.sliceDoc(close.from, close.to) })
    else taken.push(open)
    if (after < close.from) openings.push({ from: after, insert: state.sliceDoc(open.from, open.to) })
    else taken.push(close)
  }
  return [...closings, ...taken, ...openings]
}
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    if (range.empty) return { range }
    const changes = state.changes(clearing(state, range.from, range.to))
    return {
      changes,
      range: EditorSelection.range(changes.mapPos(range.from, 1), changes.mapPos(range.to, -1)),
    }
  })
  dispatch(state.update(update, { userEvent: 'input' }))
  return true
}
