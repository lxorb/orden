/** Where a jump landed, said for a moment.
 *
 *  Following a link, opening a bookmark or being taken to a search result all end
 *  the same way: the note the reader was looking at is replaced by another one,
 *  scrolled to a place they have never seen, with nothing to say which part of it
 *  they asked for. The caret is there, but a caret is one pixel wide and the eye
 *  was somewhere else entirely.
 *
 *  So the block it landed on holds a tint for long enough to be seen and then
 *  lets go of it. A whole block rather than a line, because a block is what a
 *  link points at - except a heading, whose block is its whole section, and
 *  tinting a chapter to say "this heading" would be shouting.
 *
 *  It goes on its own, and it goes at the first thing the reader does. A mark
 *  that has to be dismissed is a mark that costs more than it says. */

import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { blockAt } from './block/span'

/** Says a jump landed at this position. Sent in the same transaction as the
 *  selection that moved the caret there, so one transaction is the whole jump. */
export const landed = StateEffect.define<number>()

/** How long the tint stays before it is taken out of the state.
 *
 *  Not a motion token, because it is not a movement: it is how long something has
 *  to be there to be noticed, which is the same whether or not the reader asked
 *  for less movement. The fade at the end of it is the movement, and that is in
 *  the stylesheet where the tokens are. */
const SEEN_FOR = 1400

const gone = StateEffect.define()

/** The lines a landing marks: the block it is in, or the heading's own line. */
function markedAt(state: EditorState, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > state.doc.length) return null

  const block = blockAt(state, pos)
  const line = state.doc.lineAt(pos)
  if (!block || block.kind === 'heading') return { from: line.from, to: line.to }

  return { from: block.from, to: block.to }
}

const marked = StateField.define<{ from: number; to: number } | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(landed)) return markedAt(transaction.state, effect.value)
      if (effect.is(gone)) return null
    }

    // Anything the reader does takes it away: a word typed, or the caret put
    // somewhere by hand. The transaction that lands carries a selection of its
    // own, which is why the effects are read first.
    if (!value || transaction.docChanged || transaction.selection) return null

    return value
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const held = state.field(field)
      if (!held) return Decoration.none

      const doc = state.doc
      const marks = []
      for (
        let number = doc.lineAt(held.from).number;
        number <= doc.lineAt(held.to).number;
        number++
      ) {
        marks.push(Decoration.line({ class: 'nib-landed' }).range(doc.line(number).from))
      }

      return Decoration.set(marks, true)
    }),
})

/** Takes the mark out again once it has been seen. In the state rather than left
 *  to the stylesheet, so a line the editor happens to redraw does not tint
 *  itself again half a minute later. */
const forgetting = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(private readonly view: EditorView) {}

    update() {
      const held = this.view.state.field(marked, false) ?? null
      if (!held) {
        this.stop()
        return
      }
      if (this.timer !== undefined) return

      this.timer = setTimeout(() => {
        this.timer = undefined
        this.view.dispatch({ effects: gone.of(null) })
      }, SEEN_FOR)
    }

    stop() {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    destroy() {
      this.stop()
    }
  },
)

/** The mark a jump leaves behind. */
export function landing(): Extension {
  return [marked, forgetting]
}
