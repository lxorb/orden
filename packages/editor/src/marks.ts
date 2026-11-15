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
import { inCode } from './code'
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
    if (verbatim.has(number) || inCode(state, line.from) || ownLine(line.text)) continue

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
): { changes: ChangeSpec[]; range: SelectionRange } {
  const size = mark.length
  const marked = parts.every((part) => {
    const words = state.doc.sliceString(part.from, part.to)
    const stars = mark === '*' ? (/^\*+/u.exec(words)?.[0].length ?? 0) : 1
    return (
      words.length >= size * 2 && words.startsWith(mark) && words.endsWith(mark) && stars % 2 === 1
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

export function marksAcross(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const held = inside(state, range.from, range.to)
      return wrapEach(state, partsOf(state, held.from, held.to), held, mark)
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

function colourAfter(state: EditorState, mark: SyntaxNode): number {
  const highlight = mark.parent
  if (mark.name !== 'HighlightMark' || highlight?.name !== 'Highlight') return 0
  if (mark.from !== highlight.from) return 0
  return readHighlight(state.doc.sliceString(mark.to, highlight.to - mark.to + mark.from)).from
}

function markRanges(state: EditorState, from: number, to: number): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = []
  const take = (start: number, end: number) => {
    const clipped = { from: Math.max(from, start), to: Math.min(to, end) }
    if (clipped.to > clipped.from) found.push(clipped)
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (MARKS.has(node.name)) take(node.from, node.to + colourAfter(state, node.node))
      if (node.name !== 'InlineCode') return true

      const said = state.doc.sliceString(node.from, node.to)
      const opening = /^`+ ?/u.exec(said)?.[0].length ?? 0
      const closing = / ?`+$/u.exec(said.slice(opening))?.[0].length ?? 0
      take(node.from, node.from + opening)
      take(node.to - closing, node.to)
      return false
    },
  })

  return found
}

function clearedOf(state: EditorState, from: number, to: number): string {
  let out = ''
  let at = from
  for (const mark of markRanges(state, from, to)) {
    if (mark.from < at) continue
    out += state.doc.sliceString(at, mark.from)
    at = mark.to
  }
  return out + state.doc.sliceString(at, to)
}

export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    if (range.empty) return { range }

    const text = clearedOf(state, range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.range(range.from, range.from + text.length),
    }
  })

  dispatch(state.update(update, { userEvent: 'input' }))
  return true
}
