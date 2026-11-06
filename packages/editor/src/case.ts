import { EditorSelection, type StateCommand } from '@codemirror/state'

const WORD_START = /(^|[^\p{L}\p{N}'’])(\p{L})/gu

function titled(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(WORD_START, (_, before: string, letter: string) => before + letter.toLocaleUpperCase())
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
        const insert = change(text)
        return insert === text ? [] : [{ from: word.from, to: word.to, insert }]
      }),
    )
    if (changes.empty) return true

    const selection = ranges.map((range, i) => {
      const word = words[i]
      if (!word) return range.map(changes)
      const from = changes.mapPos(word.from)
      return range.empty
        ? EditorSelection.cursor(from + change(state.sliceDoc(word.from, range.head)).length)
        : EditorSelection.range(from, from + change(state.sliceDoc(word.from, word.to)).length)
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
