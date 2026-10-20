/** Upper case, lower case and title case, over what is selected.
 *
 *  VS Code's three, and the same reading of an empty selection: the word the caret
 *  is in. The selection stays over the words afterwards, so the next of the three
 *  is one press away - and it is re-measured rather than kept, because a letter can
 *  change length on the way: `ß` in capitals is `SS`. */

import { EditorSelection, type StateCommand } from '@codemirror/state'

/** A letter that starts a word: one with no letter, digit or apostrophe in front of
 *  it, so `don't` stays one word and `Don'T` never happens. */
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
        // Two carets in one word change it once.
        if (
          !word ||
          words.slice(0, i).some((other) => other?.from === word.from && other.to === word.to)
        )
          return []
        const text = state.sliceDoc(word.from, word.to)
        const insert = change(text)
        // Nothing to write where the words are already so: a press that changes
        // nothing leaves nothing in the history to undo.
        return insert === text ? [] : [{ from: word.from, to: word.to, insert }]
      }),
    )
    if (changes.empty) return true

    // A caret keeps its place among the letters, counted after the change, since a
    // letter can change length on the way.
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
