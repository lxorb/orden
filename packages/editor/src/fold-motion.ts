/** Folding, as something that moves rather than something that blinks.
 *
 *  A fold takes lines out of the note, which moves everything under them. Done
 *  in one frame that is a jump: the words the reader was looking at are suddenly
 *  somewhere else and it takes a moment to find them again. So the lines go the
 *  way a drawer shuts - their height and what they say fading together over one
 *  duration - and the fold itself lands at the end, when there is nothing left to
 *  see. Opening one runs the same movement backwards.
 *
 *  Two things make it cheap. The lines that move are the real lines, so nothing
 *  is copied and nothing can disagree with the note; and they are moved with the
 *  Web Animations API rather than by writing styles, so CodeMirror's own observer
 *  never sees an attribute change and never re-reads the document while the
 *  movement runs. What CodeMirror believes about the height of the note is a few
 *  hundred milliseconds out of date while a fold moves, which nothing asks about
 *  and the fold at the end settles.
 *
 *  Shutting is the direction that needs state: the fold cannot be applied until
 *  the lines have gone, so for that moment the note is unfolded and about to be
 *  folded, and the chevron in the margin has to say so. Opening needs none - the
 *  fold comes off first, because lines that are not drawn cannot be measured. */

import { foldEffect, unfoldEffect } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** Where a fold starts and ends, in document offsets. */
export interface FoldRange {
  from: number
  to: number
}

/** What a fold command dispatches through: a view when the fold was asked for by
 *  somebody looking at the note, and a plain pair when it was not - a test, or a
 *  state being built before it is shown. Only the first can move anything, which
 *  is the whole difference between the two paths below. */
interface FoldTarget {
  state: EditorState
  dispatch: (transaction: Transaction) => void
}

/** Folds whose lines are on their way out: the fold is not in the state yet. */
interface Shutting {
  ranges: readonly FoldRange[]
  /** Tells one movement from the next, so the one that ends knows whether it is
   *  still the one that started. */
  id: number
}

const startShut = StateEffect.define<Shutting>()
const stopShut = StateEffect.define()

/** The folds that are closing. Read by the chevrons, which turn as the movement
 *  starts rather than when it ends: the mark leads what it does.
 *
 *  A document that changed under a movement drops it. The offsets it holds were
 *  measured against the old text, and folding the range they now point at would
 *  fold something nobody asked to fold. */
const shutting = StateField.define<Shutting | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(startShut)) return effect.value
      if (effect.is(stopShut)) return null
    }

    return transaction.docChanged ? null : value
  },
})

/** Whether a line is the head of a fold that is closing. What tells the chevron
 *  to point at the block while the block is still on its way out. */
export function shuttingAt(state: EditorState, from: number, to: number): boolean {
  const now = state.field(shutting, false)
  return !!now?.ranges.some((range) => range.from >= from && range.from <= to)
}

/** Whether a movement started or ended, so the chevrons rebuild for it. */
export function shuttingChanged(update: ViewUpdate): boolean {
  return update.startState.field(shutting, false) !== update.state.field(shutting, false)
}

/** Calls off a fold that is closing: the lines come back and nothing is folded.
 *  What a second press on a chevron means while the first one is still running. */
export function stopShutting(view: EditorView): void {
  view.dispatch({ effects: stopShut.of(null) })
}

/** How long a fold takes and how it eases, as the stylesheet says.
 *
 *  Read out of the tokens rather than written here, so the app has one answer:
 *  every `--dur-*` is zeroed under `prefers-reduced-motion` (see tokens.css), and
 *  a duration of nothing is what sends every path below down its instant branch.
 *  Nothing in this file knows the setting exists. */
function movement(view: EditorView): { ms: number; easing: string } {
  const style = getComputedStyle(view.contentDOM)
  // The even curve rather than the app's usual ease out, because this is a
  // distance and not an appearance: `--ease-out` puts nine tenths of the way
  // behind you in the first third of the time, which for a whole chapter's height
  // is a snap followed by a crawl. A drawer takes as long at the end as at the
  // start.
  const easing = style.getPropertyValue('--ease-in-out').trim()

  return {
    ms: millisecondsIn(style.getPropertyValue('--dur-base')),
    easing: easing || 'ease-in-out',
  }
}

/** A CSS time, in milliseconds. Both units, because the token is written in
 *  milliseconds and the build's minifier rewrites it in seconds when that is
 *  shorter: `210ms` reaches the browser as `.21s`, and reading that as 0.21 gave
 *  a movement that was over before it began. */
function millisecondsIn(said: string): number {
  const written = said.trim()
  const number = Number.parseFloat(written)
  if (!Number.isFinite(number)) return 0

  return written.endsWith('ms') ? number : number * 1000
}

/** The room one box takes: its height, and the space packed around it. A line
 *  can carry padding and a transparent border - a code fence's top and tail, a
 *  heading's air - and room like that has to leave with the height or the block
 *  stops short of closed. */
interface Box {
  height: string
  paddingTop: string
  paddingBottom: string
  borderTopWidth: string
  borderBottomWidth: string
}

const NO_ROOM: Box = {
  height: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  borderTopWidth: '0px',
  borderBottomWidth: '0px',
}

function roomOf(el: HTMLElement): Box {
  const style = getComputedStyle(el)

  return {
    // `height` reads back as the content box, which is what setting it means
    // for everything the editor draws; a box measured any other way would be
    // one padding taller at the first frame.
    height:
      style.boxSizing === 'border-box' ? `${el.getBoundingClientRect().height}px` : style.height,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    borderTopWidth: style.borderTopWidth,
    borderBottomWidth: style.borderBottomWidth,
  }
}

/** One box on its way out or in, and the room it takes when it is all there. */
interface Move {
  el: HTMLElement
  room: Box
}

/** Whether a fold is worth moving.
 *
 *  Every line of it drawn, first: a fold reaching past what CodeMirror has
 *  rendered has no elements to move. And its own head on screen, because that is
 *  the block the reader is folding and the one thing they are certainly looking
 *  at. A movement nobody can see is a wait, and a fold in a part of the note
 *  nobody is looking at may as well simply happen - which is what they will see
 *  when they get there either way. */
function worthMoving(view: EditorView, range: FoldRange): boolean {
  if (range.to <= range.from) return false
  if (range.from < view.viewport.from || range.to > view.viewport.to) return false

  return view.visibleRanges.some((seen) => range.from >= seen.from && range.from <= seen.to)
}

/** The element a position sits in, as the writing surface's own child: a line,
 *  or a block the editor drew in place of some - a table, a diagram, a picture.
 *  Walked up to rather than looked up by class, so a block of either kind is
 *  found by the same three lines. */
function blockAt(view: EditorView, pos: number): HTMLElement | null {
  const at = view.domAtPos(pos)
  // A position at the edge of a block the editor drew - a table, a diagram - comes
  // back as the writing surface itself and which of its children the position
  // sits before, so that child is the block.
  let node: Node | null =
    at.node === view.contentDOM ? (at.node.childNodes[at.offset] ?? null) : at.node

  while (node && node.parentNode !== view.contentDOM) node = node.parentNode
  return node instanceof HTMLElement ? node : null
}

/** Every box a fold covers, measured as it stands. */
function boxesOf(view: EditorView, range: FoldRange): Move[] {
  // A fold starts at the end of the line that owns it, so the first box that
  // goes is the one after it.
  const first = blockAt(view, range.from + 1)
  const moves: Move[] = []

  // Where each box ends up in the document is what says whether it is inside the
  // fold, rather than walking to a box found for the fold's far end: an end that
  // lands on the edge of a drawn block is a position two boxes can claim, and
  // taking the wrong one either misses a line or collapses one that stays.
  for (let el: Element | null = first; el instanceof HTMLElement; el = el.nextElementSibling) {
    if (view.posAtDOM(el) > range.to) break
    moves.push({ el, room: roomOf(el) })
  }

  return moves
}

/** The two ends of the movement for one box. Opacity goes with the height so the
 *  words fade as their room does, which is what makes the swap at the end - real
 *  lines for a folded mark, or the other way about - impossible to see.
 *
 *  `overflow` is named in both frames rather than in a stylesheet: it does not
 *  interpolate, so a property with the same value at either end simply holds for
 *  as long as the movement lasts. Without it a line whose height is on its way to
 *  nothing spills its words over the lines below. */
function frame(room: Box, shown: number): Keyframe {
  return { ...room, opacity: String(shown), overflow: 'hidden' }
}

/** Starts a movement on every box, all on one clock. */
function animate(moves: readonly Move[], out: boolean, ms: number, easing: string): Animation[] {
  return moves.map(({ el, room }) =>
    el.animate(out ? [frame(room, 1), frame(NO_ROOM, 0)] : [frame(NO_ROOM, 0), frame(room, 1)], {
      duration: ms,
      easing,
      // Shutting holds the closed state until the fold lands, or the lines would
      // flash back into place for the frame in between. Opening holds only the
      // start, so the boxes are the stylesheet's again the moment they arrive:
      // a height frozen at what it measured would survive the window being
      // resized and the text rewrapping under it.
      fill: out ? 'both' : 'backwards',
    }),
  )
}

/** Holds the animations of the movement that is running, so that anything which
 *  calls the movement off can put the lines back. Cancelling restores every box
 *  to what the stylesheet says at once, which is the safe direction: a fold that
 *  was called off leaves lines that are there to be read. */
const running = ViewPlugin.fromClass(
  class {
    private held: { id: number; animations: Animation[] } | null = null

    update(update: ViewUpdate) {
      const now = update.state.field(shutting, false) ?? null
      if (this.held && now?.id !== this.held.id) this.stop()
    }

    hold(id: number, animations: Animation[]) {
      this.stop()
      this.held = { id, animations }
    }

    stop() {
      for (const one of this.held?.animations ?? []) one.cancel()
      this.held = null
    }

    destroy() {
      this.stop()
    }
  },
)

/** Which movement is running, so the one that finishes can tell whether it is
 *  still the one the state is waiting for. */
let counted = 0

/** Folds those ranges, with the lines going first when there is somebody looking
 *  at them. `caret` is whatever else the fold had to say - where the caret has to
 *  sit for the fold to hold; see foldWithCaret in fold.ts. */
export function shutFolds(
  target: FoldTarget,
  ranges: readonly FoldRange[],
  caret: TransactionSpec = {},
): void {
  const view = target instanceof EditorView ? target : null
  const { ms, easing } = view ? movement(view) : { ms: 0, easing: '' }

  const moving = view && ms > 0 ? ranges.filter((range) => worthMoving(view, range)) : []

  if (!view || !moving.length) {
    target.dispatch(
      target.state.update({ effects: ranges.map((range) => foldEffect.of(range)), ...caret }),
    )
    return
  }

  const id = ++counted

  view.dispatch({
    effects: [
      // A fold that was already on its way shut lands here rather than being
      // lost: two chevrons pressed in quick succession fold both blocks, the
      // first one at once and the second one moving.
      ...(view.state.field(shutting, false)?.ranges ?? []).map((range) => foldEffect.of(range)),
      // And a fold nobody can see does not wait for a movement nobody can see.
      ...ranges.filter((range) => !moving.includes(range)).map((range) => foldEffect.of(range)),
      startShut.of({ id, ranges: moving }),
    ],
    ...caret,
  })

  // Measured after that transaction rather than before it, so anything it did
  // fold is already out of the way and every box is where it is going to be.
  const moves = moving.flatMap((range) => boxesOf(view, range))
  const land = (effects: StateEffect<unknown>[]) => view.dispatch({ effects })

  if (!moves.length) {
    land([...moving.map((range) => foldEffect.of(range)), stopShut.of(null)])
    return
  }

  const animations = animate(moves, true, ms, easing)
  view.plugin(running)?.hold(id, animations)

  Promise.all(animations.map((one) => one.finished))
    .then(() => {
      // Anything that called this movement off cancelled these animations, and a
      // cancelled animation rejects rather than arriving here. The id is asked
      // all the same: it is the state, and not this closure, that decides which
      // fold is still waiting to land.
      if (view.state.field(shutting, false)?.id !== id) return
      land([...moving.map((range) => foldEffect.of(range)), stopShut.of(null)])
    })
    .catch(() => undefined)
}

/** Opens those folds, with the lines growing back into place.
 *
 *  The fold comes off first, because lines that are not drawn cannot be measured.
 *  Both halves run in one task, so the frame the reader sees is the first frame
 *  of the movement rather than the whole block arriving and then collapsing. */
export function openFolds(target: FoldTarget, ranges: readonly FoldRange[]): void {
  // Anything still closing is called off first: "open everything" cannot leave a
  // fold on its way shut, which would land a moment later on top of this.
  const called = target.state.field(shutting, false) ? [stopShut.of(null)] : []

  target.dispatch(
    target.state.update({
      effects: [...called, ...ranges.map((range) => unfoldEffect.of(range))],
    }),
  )

  const view = target instanceof EditorView ? target : null
  if (!view) return

  const { ms, easing } = movement(view)
  if (ms <= 0) return

  const moves = ranges
    .filter((range) => worthMoving(view, range))
    .flatMap((range) => boxesOf(view, range))
  if (!moves.length) return

  // Nothing holds these: an opening movement has no fold waiting behind it, so
  // the worst an interrupted one does is end with the lines where they belong.
  const animations = animate(moves, false, ms, easing)

  Promise.all(animations.map((one) => one.finished))
    // The editor measures the lines it draws, and while they are moving it can
    // measure one mid-movement and believe the note is shorter than it is. The
    // shutting side settles that with the transaction that lands the fold; this
    // side has none, so it asks for the measurement itself.
    .then(() => view.requestMeasure())
    .catch(() => undefined)
}

/** The state and the bookkeeping a moving fold needs. Installed by folding(). */
export function foldMovement(): Extension {
  return [shutting, running]
}
