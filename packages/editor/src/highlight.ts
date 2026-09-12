/** Highlighting the selection, in one of the six colours.
 *
 *  `toggleWrap('==')` in commands.ts already puts the marks on and takes them off
 *  again; what it cannot do is the colour, which lives inside the marks -
 *  `==🔴 careful==` is how Obsidian 1.14 writes one and so is how nib writes one;
 *  see highlights.ts in @nib/markdown.
 *
 *  So this is `toggleWrap` with one more question asked. Pressing the same colour
 *  twice takes the highlight off, the way pressing bold twice does; pressing a
 *  different colour on a highlight that already has one changes the colour rather
 *  than nesting a second highlight inside it, because a highlight inside a
 *  highlight is not a thing anybody means. */

import { EditorSelection, type StateCommand } from '@codemirror/state'
import {
  HIGHLIGHT_COLOURS,
  type HighlightColour,
  highlightTone,
  readHighlight,
  writeHighlight,
} from '@nib/markdown/highlights'

const MARK = '=='

/** The colour the plain gesture writes: the shortcut, the format bar's own button
 *  and the Highlight row in the menu.
 *
 *  The last one chosen sticks, because marking up a paper is one colour a dozen
 *  times. Held here rather than asked for per keystroke, so the shortcut and the
 *  table's own `h` need nothing threaded into them; the app sets it and remembers
 *  it, the way it hands the snippets over. See modes.svelte.ts. */
let sticky: HighlightColour = highlightTone(null)

export function setHighlightColour(colour: HighlightColour) {
  sticky = colour
}

/** Everything a highlight can open with, longest first: the marks alone, and the
 *  marks with a colour's emoji after them, written with the space Obsidian writes
 *  and without it. Longest first, so `==🔴 ` is matched before the `==` inside it
 *  and the emoji is read as the colour rather than as a word.
 *
 *  The selection a reader makes is the words, not the colour in front of them, so
 *  a colour already there has to be recognised from outside the selection - which
 *  is what this is for. */
const OPENINGS = [
  ...HIGHLIGHT_COLOURS.flatMap((colour) =>
    colour.emoji === null ? [] : [`${MARK}${colour.emoji} `, `${MARK}${colour.emoji}`],
  ),
  MARK,
].sort((one, other) => other.length - one.length)

/** The words a highlight shows and where they sit, for a selection that is one
 *  already - either because the marks are just outside it, or because they are
 *  part of it. Null for a selection that is not a highlight. */
function highlighted(
  doc: { sliceString(from: number, to: number): string; length: number },
  from: number,
  to: number,
): { from: number; to: number; inner: string } | null {
  // Markers sit just outside the selection, the colour among them.
  if (doc.sliceString(to, Math.min(doc.length, to + MARK.length)) === MARK) {
    for (const opening of OPENINGS) {
      const at = from - opening.length
      if (at < 0 || doc.sliceString(at, from) !== opening) continue

      return { from: at, to: to + MARK.length, inner: doc.sliceString(at + MARK.length, to) }
    }
  }

  const text = doc.sliceString(from, to)

  // Markers are part of the selection.
  if (text.length >= MARK.length * 2 && text.startsWith(MARK) && text.endsWith(MARK)) {
    return { from, to, inner: text.slice(MARK.length, text.length - MARK.length) }
  }

  return null
}

/** Highlights the selection in this colour, or takes the highlight off when it is
 *  already that colour.
 *
 *  A colour with no emoji is the plain highlight every note already holds, so this
 *  is also the command the `==` shortcut and the format bar's own button run. */
export function toggleHighlight(colour: HighlightColour): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const { from, to } = range
      const already = highlighted(state.doc, from, to)

      if (already) {
        const { colour: had, from: at } = readHighlight(already.inner)
        const words = already.inner.slice(at)

        // The same colour again: the highlight comes off, and what is left is the
        // words without the mark that named it.
        if (had.emoji === colour.emoji) {
          return {
            changes: { from: already.from, to: already.to, insert: words },
            range: EditorSelection.range(already.from, already.from + words.length),
          }
        }

        // A different colour: the marks stay and only what is between them moves.
        const inner = writeHighlight(words, colour)
        return {
          changes: {
            from: already.from + MARK.length,
            to: already.to - MARK.length,
            insert: inner,
          },
          range: EditorSelection.range(
            already.from + MARK.length,
            already.from + MARK.length + inner.length,
          ),
        }
      }

      const inner = writeHighlight(state.doc.sliceString(from, to), colour)
      return {
        changes: { from, to, insert: `${MARK}${inner}${MARK}` },
        range: EditorSelection.range(from + MARK.length, from + MARK.length + inner.length),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

/** Highlights the selection in whatever colour was chosen last. What the shortcut
 *  runs, and what a row or a button that is about highlighting rather than about
 *  one particular colour runs. */
export const highlightSelection: StateCommand = (target) => toggleHighlight(sticky)(target)
