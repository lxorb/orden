import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import { blockIdOf } from '@orden/markdown/links'

const WORD_START = /(^|[^\p{L}\p{N}'’])(\p{L})/gu

const titled = (text: string): string =>
  text
    .toLocaleLowerCase()
    .replace(WORD_START, (_, before: string, letter: string) => before + letter.toLocaleUpperCase())

interface Span {
  from: number
  to: number
}

const ADDRESSES = new Set(['URL', 'WikilinkMark'])

const BLOCK_TARGET = /#\^[^|\]]*/

function blockTarget(state: EditorState, from: number, to: number): Span[] {
  const found = BLOCK_TARGET.exec(state.sliceDoc(from, to))
  return found ? [{ from: from + found.index, to: from + found.index + found[0].length }] : []
}

function keptSpans(state: EditorState, from: number, to: number): Span[] {
  const kept: Span[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (ADDRESSES.has(node.name)) kept.push({ from: node.from, to: node.to })
      if (node.name === 'Wikilink') kept.push(...blockTarget(state, node.from, node.to))
    },
  })

  const last = state.doc.lineAt(to).number
  for (let number = state.doc.lineAt(from).number; number <= last; number++) {
    const line = state.doc.line(number)
    const id = blockIdOf(line.text)
    if (!id) continue
    const at = line.from + line.text.lastIndexOf(`^${id}`)
    kept.push({ from: at, to: at + id.length + 1 })
  }
  return kept.sort((one, other) => one.from - other.from)
}

function changedAround(
  state: EditorState,
  from: number,
  to: number,
  change: (text: string) => string,
): string {
  let out = ''
  let at = from
  for (const span of keptSpans(state, from, to)) {
    const start = Math.min(Math.max(span.from, at), to)
    const end = Math.min(span.to, to)
    if (end <= at) continue
    out += change(state.sliceDoc(at, start)) + state.sliceDoc(start, end)
    at = end
  }
  return out + change(state.sliceDoc(at, to))
}

function recased(change: (text: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    const { ranges, mainIndex } = state.selection
    const words = ranges.map((range) => (range.empty ? state.wordAt(range.head) : range))
    const changes = state.changes(
      words.flatMap((word, i) => {
        if (
          !word ||
          words.slice(0, i).some((other) => other?.from === word.from && other.to === word.to)
        )
          return []
        const text = state.sliceDoc(word.from, word.to)
        const insert = changedAround(state, word.from, word.to, change)
        return insert === text ? [] : [{ from: word.from, to: word.to, insert }]
      }),
    )
    if (changes.empty) return true

    const selection = ranges.map((range, i) => {
      const word = words[i]
      if (!word) return range.map(changes)
      const from = changes.mapPos(word.from)
      return range.empty
        ? EditorSelection.cursor(from + changedAround(state, word.from, range.head, change).length)
        : EditorSelection.range(
            from,
            from + changedAround(state, word.from, word.to, change).length,
          )
    })
    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(selection, mainIndex),
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const upperCase = recased((text) => text.toLocaleUpperCase())
export const lowerCase = recased((text) => text.toLocaleLowerCase())
export const titleCase = recased(titled)
