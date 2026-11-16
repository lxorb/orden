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

interface Part {
  from: number
  to: number
}

function partsOf(state: EditorState, from: number, to: number): Part[] {
  const verbatim = verbatimLines(state, from, to)
  if (!verbatim.size && !BLOCKS_APART.test(state.doc.sliceString(from, to))) return [{ from, to }]

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

function wrapEach(
  state: EditorState,
  parts: readonly Part[],
  range: Part,
  mark: string,
  adding: boolean,
): { changes: ChangeSpec[]; range: SelectionRange } {
  const size = mark.length
  const marked =
    !adding &&
    parts.every((part) => {
      const words = state.doc.sliceString(part.from, part.to)
      const stars = mark === '*' ? (/^\*+/u.exec(words)?.[0].length ?? 0) : 1
      return (
        words.length >= size * 2 &&
        words.startsWith(mark) &&
        words.endsWith(mark) &&
        stars % 2 === 1
      )
    })

  const changes = parts.flatMap((part): ChangeSpec[] =>
    marked
      ? [
          { from: part.from, to: part.from + size },
          { from: part.to - size, to: part.to },
        ]
      : [
          { from: part.from, insert: mark },
          { from: part.to, insert: mark },
        ],
  )
  const grown = (marked ? -size : size) * 2 * parts.length
  return { changes, range: EditorSelection.range(range.from, range.to + grown) }
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

export function highlightAcross(colour: HighlightColour): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const held = inside(state, range.from, range.to)
      const parts = partsOf(state, held.from, held.to)
      const words = parts.map((part) => state.doc.sliceString(part.from, part.to))
      const size = HIGHLIGHT.length
      const lit = words.every(
        (text) => text.length >= size * 2 && text.startsWith(HIGHLIGHT) && text.endsWith(HIGHLIGHT),
      )

      const changes = state.changes(
        parts.flatMap((part, at): ChangeSpec[] => {
          if (!lit) {
            return [
              { from: part.from, insert: HIGHLIGHT + writeHighlight('', colour) },
              { from: part.to, insert: HIGHLIGHT },
            ]
          }
          const inner = (words[at] ?? '').slice(size, -size)
          return [
            { from: part.from, to: part.from + size + readHighlight(inner).from },
            { from: part.to - size, to: part.to },
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
    const after =
      close.from - state.sliceDoc(Math.min(to, close.from), close.from).trimStart().length

    if (before > open.to)
      closings.unshift({ from: before, insert: state.sliceDoc(close.from, close.to) })
    else taken.push(open)
    if (after < close.from)
      openings.push({ from: after, insert: state.sliceDoc(open.from, open.to) })
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
