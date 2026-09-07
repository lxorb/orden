/** Typing a mark with something selected puts it around the selection.
 *
 *  closeBrackets does this for `(`, `[`, `{` and the two quotes: with a run of
 *  words selected, the bracket lands on both sides of it instead of replacing
 *  it. Markdown's own marks are the same gesture - a backtick around a word is
 *  code, a `*` around it is emphasis - and Typora and Obsidian both answer that
 *  way, so the marks are here beside the brackets rather than needing a
 *  shortcut nobody would guess.
 *
 *  The selection stays on the text between the marks, which is what makes the
 *  next press an upgrade rather than a second guess: `*x*` typed over again is
 *  `**x**`, and `~x~` is `~~x~~`. Nothing changes when there is no selection -
 *  a `*` typed on its own is a `*`. */

import {
  type EditorState,
  EditorSelection,
  type Extension,
  Prec,
  type SelectionRange,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { inCode } from './code'

/** The marks a selection can be wrapped in. The backtick is inline code; `*`
 *  and `_` are emphasis and double up into strong, `~` into a strikethrough and
 *  `=` into a highlight. */
const MARKS = new Set(['`', '*', '_', '~', '='])

/** Whether either end of the selection is in code. Both ends, because a
 *  selection that starts in prose and ends in a fence is not prose. */
function inside(state: EditorState, range: SelectionRange): boolean {
  return inCode(state, range.from) || inCode(state, range.to, -1)
}

export function wrapSelection(): Extension {
  // Ahead of the rest so the mark never lands as a plain character first.
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, typed) => {
      if (typed.length !== 1 || !MARKS.has(typed)) return false

      const { state } = view
      if (state.readOnly || view.compositionStarted) return false

      // The same guard closeBrackets uses: this is about the selection the
      // reader can see, not about text arriving somewhere else.
      const main = state.selection.main
      if (from !== main.from || to !== main.to) return false

      // Nothing selected is nothing to wrap, and one empty range among several
      // means the same: the character types as itself, everywhere at once.
      if (state.selection.ranges.some((range) => range.empty)) return false

      // In code a mark is a character like any other, so it replaces the
      // selection the way typing always does.
      if (state.selection.ranges.some((range) => inside(state, range))) return false

      const wrapped = state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: typed },
          { from: range.to, insert: typed },
        ],
        // The text between, still selected and still pointing the way it was,
        // so a second press wraps it again.
        range: EditorSelection.range(range.anchor + 1, range.head + 1),
      }))

      view.dispatch(state.update(wrapped, { scrollIntoView: true, userEvent: 'input.type' }))
      return true
    }),
  )
}
