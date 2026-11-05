import { syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from '@codemirror/state'
import { blockIdOf, ownLine } from '@orden/markdown/links'
import { verbatimLines } from './block/verbatim'
import { inCode } from './code'
import { inside } from './commands'

const OPENING =
  /^[ \t]*(?:>[ \t]?)*[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/u

const BLOCKS_APART = /\n[ \t]*\n|\n[ \t]*(?:[-*+]|\d+[.)])[ \t]/u

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

const INLINE_MARKERS = /(\*\*|\*|~~|==|`|(?<![\p{L}\p{N}])__?|__?(?![\p{L}\p{N}]))/gu

function clearedOf(state: EditorState, from: number, to: number): string {
  let out = ''
  let at = from
  const strip = (end: number) => {
    if (end > at) out += state.doc.sliceString(at, end).replace(INLINE_MARKERS, '')
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (!['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return true

      const start = Math.max(from, node.from)
      const end = Math.min(to, node.to)
      strip(start)
      const said = state.doc.sliceString(start, end)
      out += node.name === 'InlineCode' ? said.replace(/^`+ ?| ?`+$/gu, '') : said
      at = end
      return false
    },
  })
  strip(to)

  return out
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
