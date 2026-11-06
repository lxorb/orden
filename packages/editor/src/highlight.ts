import { EditorSelection, type StateCommand } from '@codemirror/state'
import {
  HIGHLIGHT_COLOURS,
  type HighlightColour,
  highlightTone,
  readHighlight,
  writeHighlight,
} from '@orden/markdown/highlights'

const MARK = '=='

let sticky: HighlightColour = highlightTone(null)

export function setHighlightColour(colour: HighlightColour) {
  sticky = colour
}

const OPENINGS = [
  ...HIGHLIGHT_COLOURS.flatMap((colour) =>
    colour.emoji === null ? [] : [`${MARK}${colour.emoji} `, `${MARK}${colour.emoji}`],
  ),
  MARK,
].sort((one, other) => other.length - one.length)

function highlighted(
  doc: { sliceString(from: number, to: number): string; length: number },
  from: number,
  to: number,
): { from: number; to: number; inner: string } | null {
  if (doc.sliceString(to, Math.min(doc.length, to + MARK.length)) === MARK) {
    for (const opening of OPENINGS) {
      const at = from - opening.length
      if (at < 0 || doc.sliceString(at, from) !== opening) continue

      return { from: at, to: to + MARK.length, inner: doc.sliceString(at + MARK.length, to) }
    }
  }

  const text = doc.sliceString(from, to)

  if (text.length >= MARK.length * 2 && text.startsWith(MARK) && text.endsWith(MARK)) {
    return { from, to, inner: text.slice(MARK.length, text.length - MARK.length) }
  }

  return null
}

export function toggleHighlight(colour: HighlightColour): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const { from, to } = range
      const already = highlighted(state.doc, from, to)

      if (already) {
        const { colour: had, from: at } = readHighlight(already.inner)
        const words = already.inner.slice(at)

        if (had.emoji === colour.emoji) {
          return {
            changes: { from: already.from, to: already.to, insert: words },
            range: EditorSelection.range(already.from, already.from + words.length),
          }
        }

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

export const highlightSelection: StateCommand = (target) => toggleHighlight(sticky)(target)
