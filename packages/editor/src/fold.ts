/** Folding: a heading's section, a list item's children, a callout's body, a
 *  fence or a table put out of sight until it is wanted again.
 *
 *  What folding is *for* is skimming. A note long enough to need it is a note
 *  nobody reads top to bottom, and the shape of it - the headings - is the map.
 *  So there are three commands and not six:
 *
 *  - **Fold**, which folds whatever the caret is inside and opens it again on a
 *    second press. One command, because the chevron in the margin is a toggle
 *    too and two names for one gesture is two things to learn.
 *  - **Fold everything**, which folds the top-level heading sections and
 *    nothing else. Not the lists, not the callouts, not the fences: those are
 *    content, and hiding them does not draw a map. What is left on screen is
 *    the outline of the note.
 *  - **Unfold everything**, which opens all of it, whatever was folded and
 *    however it came to be folded. Deliberately not the mirror image of the one
 *    above: "show me all of it" has only one honest reading.
 *
 *  Obsidian's fold more and fold less - one heading level deeper or shallower,
 *  globally - are left out. They need a number nobody can see (which level are
 *  we on?), they cost two menu rows and two chords, and the two things people
 *  actually do are "show me the outline" and "get this one section out of my
 *  way", which the three above already are.
 *
 *  Nothing here decides *what* can fold. `foldable` does, and it answers out of
 *  the language: `@codemirror/lang-markdown` registers a fold service for a
 *  heading's section and a fold prop for every other block - a list item with
 *  children, a blockquote or callout, a fence, an indented block, a table. One
 *  source of truth for the ranges, so a chevron, a chord and a restored fold
 *  can never disagree about where a fold ends.
 *
 *  A fold is view state and never touches the file: see foldLines below, which
 *  is what the app writes down per note per device. */

import { codeFolding, foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language'
import type { EditorState, Extension, Line, StateCommand, TransactionSpec } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { label } from './labels'
import { NibWidget } from './live-preview/widget'

/** Where a fold starts and ends, in document offsets. */
interface FoldRange {
  from: number
  to: number
}

/** A fold as it is written down: the line that owns it and the last line it
 *  covers, counting from one.
 *
 *  Lines rather than offsets, because a note edited elsewhere between one
 *  reading and the next has moved every offset in it while the lines around a
 *  heading are usually still the lines around that heading. And two numbers a
 *  person could read, rather than a serialised range set. */
export type FoldLines = readonly [head: number, last: number]

/** Which lines could open a fold, judged on their first characters: a heading, a
 *  quote or callout, a list item, a fence. `foldable` resolves the syntax tree,
 *  so it is only asked about a line that could plausibly answer yes. */
const COULD_FOLD = /^[ \t]*(?:#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|```|~~~)/

const HEADING = /^[ \t]*#{1,6}[ \t]/

/** The fold a line opens, or nothing. */
function foldAtLine(state: EditorState, line: Line): FoldRange | null {
  return foldable(state, line.from, line.to) ?? null
}

/** The folded range a line already owns, or nothing. */
function foldedAtLine(state: EditorState, line: Line): FoldRange | null {
  let found: FoldRange | null = null
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (from >= line.from && from <= line.to && !found) found = { from, to }
  })
  return found
}

/** The fold the caret is inside: the nearest line at or above it that opens one
 *  reaching past it. Nearest, so a heading inside a heading gives up the
 *  section the caret is actually in rather than the whole chapter. */
function enclosingFold(state: EditorState, pos: number): FoldRange | null {
  const start = state.doc.lineAt(pos)

  for (let number = start.number; number >= 1; number--) {
    const line = state.doc.line(number)
    if (!COULD_FOLD.test(line.text)) continue

    const range = foldAtLine(state, line)
    if (range && range.to >= pos) return range
  }

  return null
}

/** Folds a range, keeping the caret somewhere it can still be seen.
 *
 *  A fold starts at the end of the line that owns it, so putting the caret
 *  there is putting it on the one line of the fold that stays on screen. The
 *  library drops any fold that covers the selection head, and a head exactly on
 *  a fold's first offset does not count as covered - which is why this is the
 *  one place the caret may be moved and the fold still holds. */
function foldWithCaret(state: EditorState, range: FoldRange): TransactionSpec {
  const head = state.selection.main.head
  const swallowed = head > range.from && head < range.to

  return {
    effects: foldEffect.of(range),
    ...(swallowed ? { selection: { anchor: range.from } } : {}),
  }
}

/** Folds what the caret is in, or opens it again.
 *
 *  The caret's own line first: pressing the key on a heading folds that
 *  heading, and pressing it again opens it. Only when the caret's line owns no
 *  fold does this look outwards for the one the caret is inside. */
export const toggleFold: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head)

  const open = foldedAtLine(state, line)
  if (open) {
    dispatch(state.update({ effects: unfoldEffect.of(open) }))
    return true
  }

  const range = enclosingFold(state, state.selection.main.head)
  if (!range) return false

  dispatch(state.update(foldWithCaret(state, range)))
  return true
}

/** Every top-level heading section, folded: the outline of the note.
 *
 *  Top-level, because a section already folded hides the headings inside it and
 *  folding those as well would be work nobody can see. Walking past a folded
 *  section rather than into it also keeps the ranges from nesting, so exactly
 *  one of them can hold the caret. */
export const foldHeadings: StateCommand = ({ state, dispatch }) => {
  const ranges: FoldRange[] = []
  const head = state.selection.main.head
  let holder: FoldRange | null = null

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (!HEADING.test(line.text)) continue

    const range = foldAtLine(state, line)
    if (!range) continue

    ranges.push(range)
    if (head > range.from && head < range.to) holder = range
    number = state.doc.lineAt(range.to).number
  }

  if (!ranges.length) return false

  dispatch(
    state.update({
      effects: ranges.map((range) => foldEffect.of(range)),
      ...(holder ? { selection: { anchor: holder.from } } : {}),
    }),
  )
  return true
}

/** Opens all of it. */
export const unfoldEverything: StateCommand = ({ state, dispatch }) => {
  const open: FoldRange[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    open.push({ from, to })
  })

  if (!open.length) return false

  dispatch(state.update({ effects: open.map((range) => unfoldEffect.of(range)) }))
  return true
}

/** What is folded, as lines, ready to be written down beside the scroll
 *  position.
 *
 *  In document order, and sorted rather than trusted to arrive that way: a range
 *  set keeps its ranges in chunks and hands back one chunk after another, so a
 *  fold made after a wider one that starts above it comes out last. Order is not
 *  cosmetic here - putting these back is a range set being built, and a range
 *  set refuses ranges out of order. */
export function foldLines(state: EditorState): FoldLines[] {
  const out: FoldLines[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    out.push([state.doc.lineAt(from).number, state.doc.lineAt(to).number])
  })

  return out.sort((one, other) => one[0] - other[0] || one[1] - other[1])
}

/** The folds those lines stand for, in this document.
 *
 *  A pair naming a line the note no longer has, or naming the same line twice,
 *  is dropped rather than guessed at: a note that grew shorter somewhere else
 *  should open readable, not with a fold over whatever now sits there. */
function foldsFor(state: EditorState, lines: readonly FoldLines[]): FoldRange[] {
  const out: FoldRange[] = []

  for (const [head, last] of lines) {
    if (head < 1 || last <= head || last > state.doc.lines) continue
    out.push({ from: state.doc.line(head).to, to: state.doc.line(last).to })
  }

  // Sorted here as well as on the way out, because what was written down may
  // have been written by a build that did not sort, and a range set out of order
  // is an exception rather than a wrong fold.
  return out.sort((one, other) => one.from - other.from || one.to - other.to)
}

/** A state with those folds already in it.
 *
 *  In the state rather than dispatched into the view afterwards, for the same
 *  reason the caret is: a fold applied a frame later is a frame the reader
 *  spends looking at the note unfolded. The selection rides along so the
 *  library drops any fold that would have covered the caret. */
export function withFolds(state: EditorState, lines: readonly FoldLines[]): EditorState {
  const ranges = foldsFor(state, lines)
  if (!ranges.length) return state

  return state.update({
    effects: ranges.map((range) => foldEffect.of(range)),
    selection: state.selection,
  }).state
}

/** Whether two written-down sets of folds say the same thing. What tells a fold
 *  worth writing down from one already written: the two arrive in document order,
 *  so this is a walk rather than a comparison of sets. */
export function sameFolds(
  one: readonly FoldLines[] | undefined,
  other: readonly FoldLines[] | undefined,
): boolean {
  const first = one ?? []
  const second = other ?? []
  if (first.length !== second.length) return false

  for (let at = 0; at < first.length; at++) {
    const mine = first[at]
    const theirs = second[at]
    if (!mine || !theirs) return false
    if (mine[0] !== theirs[0] || mine[1] !== theirs[1]) return false
  }

  return true
}

/** Whether an update folded or unfolded anything. The field is a range set, and
 *  a new one is a different object, so identity is the whole question. */
export function foldsChanged(update: ViewUpdate): boolean {
  return foldedRanges(update.startState) !== foldedRanges(update.state)
}

/** Lucide's chevron-right, turned by the stylesheet when the fold is open. */
function chevron(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'm9 18 6-6-6-6')
  svg.append(path)
  return svg
}

/** The chevron in the margin beside anything that can fold.
 *
 *  Calm: nothing until the pointer is on the line, and always there once the
 *  line is folded, since that is the one state a reader has to be able to
 *  undo. A finger gets it at `--touch-target` and gets it always, because a
 *  screen with no pointer has no hover to reveal it with.
 *
 *  Where the fold is comes from the document at the moment of the press rather
 *  than from the widget, so a widget kept across an edit cannot act on a range
 *  that has moved. */
class FoldWidget extends NibWidget {
  constructor(private readonly folded: boolean) {
    super()
  }

  override eq(other: FoldWidget) {
    return other.folded === this.folded
  }

  /** The same element, told it is open now: a fresh one would start the
   *  chevron's turn over from nothing and the turn is the whole point. */
  override updateDOM(dom: HTMLElement) {
    const hinge = dom.firstElementChild
    if (!(hinge instanceof HTMLElement)) return false

    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', label(this.folded ? 'unfold' : 'fold'))
    return true
  }

  toDOM(view: EditorView) {
    // The slot holds no width of its own, so the line starts exactly where it
    // would have; the hinge hangs off it into the margin.
    const slot = document.createElement('span')
    slot.className = 'nib-fold'
    slot.contentEditable = 'false'

    const hinge = document.createElement('button')
    hinge.type = 'button'
    hinge.className = 'nib-fold-hinge'
    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', label(this.folded ? 'unfold' : 'fold'))
    // Not in the tab order: every foldable block would be a stop on the way
    // through a note. The keyboard's way in is the command.
    hinge.tabIndex = -1
    hinge.append(chevron())

    hinge.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(hinge)
      const line = view.state.doc.lineAt(pos)
      const open = foldedAtLine(view.state, line)

      if (open) view.dispatch({ effects: unfoldEffect.of(open) })
      else {
        const range = foldAtLine(view.state, line)
        if (range) view.dispatch(foldWithCaret(view.state, range))
      }
    })

    slot.append(hinge)
    return slot
  }

  override ignoreEvent() {
    return false
  }
}

/** What is left where a fold took the words away: a mark that says there is
 *  more, in no words at all. */
function placeholder(_view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const more = document.createElement('span')
  more.className = 'nib-folded'
  more.setAttribute('aria-label', label('unfold'))
  more.textContent = '⋯'
  more.addEventListener('click', onclick)
  return more
}

/** A chevron on every line in view that can fold. Rebuilt when the document,
 *  the viewport or what is folded changes - which is exactly when the answer
 *  can differ. */
const hinges = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || foldsChanged(update)) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks = []
  const { state } = view

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)

      if (COULD_FOLD.test(line.text)) {
        const folded = foldedAtLine(state, line)
        if (folded || foldAtLine(state, line)) {
          marks.push(
            Decoration.widget({ widget: new FoldWidget(!!folded), side: -1 }).range(line.from),
          )
        }
      }

      if (line.to >= state.doc.length) break
      pos = line.to + 1
    }
  }

  return Decoration.set(marks, true)
}

/** Everything folding needs to work: the state the folds live in, the mark left
 *  behind, and the chevron that reaches them with a pointer. */
export function folding(): Extension {
  return [codeFolding({ placeholderDOM: placeholder }), hinges]
}
