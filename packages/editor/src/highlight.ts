import { syntaxTree } from '@codemirror/language'
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
} from '@codemirror/state'
import {
  HIGHLIGHT_COLOURS,
  type HighlightColour,
  highlightTone,
  readHighlight,
  writeHighlight,
} from '@orden/markdown/highlights'
import { BETWEEN_WORDS, inside, spansLines } from './commands'
import { highlightAcross } from './line-door'
import { enclosingNamed } from './nodes'

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

function runAt(
  state: EditorState,
  pos: number,
): { from: number; to: number; inner: string } | null {
  const run = enclosingNamed(syntaxTree(state).resolveInner(pos, 0), 'Highlight')
  if (!run || pos < run.from + MARK.length || pos > run.to - MARK.length) return null
  return {
    from: run.from,
    to: run.to,
    inner: state.doc.sliceString(run.from + MARK.length, run.to - MARK.length),
  }
}

function colourOf(inner: string): { colour: HighlightColour; from: number } {
  const bare = HIGHLIGHT_COLOURS.find(
    (colour) => colour.emoji !== null && inner.trimEnd() === colour.emoji,
  )
  return bare ? { colour: bare, from: inner.length } : readHighlight(inner)
}

function splitOut(
  state: EditorState,
  run: { from: number; to: number; inner: string },
  from: number,
  to: number,
  colour: HighlightColour,
) {
  const { colour: had, from: at } = colourOf(run.inner)
  const start = run.from + MARK.length + at
  const end = run.to - MARK.length
  if (from < start || to > end) return null

  const doc = state.doc
  const opening = doc.sliceString(run.from, start)
  const recolour = had.emoji === colour.emoji ? null : MARK + writeHighlight('', colour)
  const changes: ChangeSpec[] = []

  if (from === start) changes.push({ from: run.from, to: start })
  else {
    let close = from
    while (close > start && BETWEEN_WORDS.test(doc.sliceString(close - 1, close))) close--
    changes.push({ from: close, insert: MARK })
  }
  if (recolour) changes.push({ from, insert: recolour }, { from: to, insert: MARK })
  if (to === end) changes.push({ from: end, to: run.to })
  else {
    let open = to
    while (open < end && BETWEEN_WORDS.test(doc.sliceString(open, open + 1))) open++
    changes.push({ from: open, insert: opening })
  }

  const set = state.changes(changes)
  return { changes: set, range: EditorSelection.range(set.mapPos(from, 1), set.mapPos(to, -1)) }
}

export function toggleHighlight(colour: HighlightColour): StateCommand {
  return (target) => {
    const { state, dispatch } = target
    if (state.selection.ranges.some((range) => spansLines(state, range))) {
      return highlightAcross(colour)(target)
    }

    const update = state.changeByRange((range) => {
      const { from, to } = inside(state, range.from, range.to)
      const already = highlighted(state.doc, from, to) ?? (from === to ? runAt(state, from) : null)

      const holding = !already && from < to ? runAt(state, from) : null
      const split = holding && splitOut(state, holding, from, to, colour)
      if (split) return split

      if (already) {
        const { colour: had, from: at } = colourOf(already.inner)
        const words = already.inner.slice(at)

        if (had.emoji === colour.emoji) {
          const start = already.from + MARK.length + at
          return {
            changes: { from: already.from, to: already.to, insert: words },
            range:
              from === to && from >= start
                ? EditorSelection.cursor(already.from + from - start)
                : EditorSelection.range(already.from, already.from + words.length),
          }
        }

        const inner = writeHighlight(words, colour)
        return {
          changes: {
            from: already.from + MARK.length,
            to: already.to - MARK.length,
            insert: inner,
          },
          range: words
            ? EditorSelection.range(
                already.from + MARK.length,
                already.from + MARK.length + inner.length,
              )
            : EditorSelection.cursor(already.from + MARK.length + inner.length),
        }
      }

      const inner = writeHighlight(state.doc.sliceString(from, to), colour)
      const end = from + MARK.length + inner.length
      return {
        changes: { from, to, insert: `${MARK}${inner}${MARK}` },
        range:
          from === to
            ? EditorSelection.cursor(end)
            : EditorSelection.range(from + MARK.length, end),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const highlightSelection: StateCommand = (target) => toggleHighlight(sticky)(target)
