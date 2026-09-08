/** What the bar is set to, for every canvas at once.
 *
 *  One tool across the app rather than one per tab: somebody who picked a green
 *  highlighter picked a green highlighter, and opening a second plane is not a
 *  reason to hand them a black biro again. Held for the sitting and not written
 *  anywhere, because a tool is what your hand is doing now, not a preference.
 *
 *  The pen itself is not here. It is a thing somebody owns and keeps, so it lives
 *  in `pens.svelte.ts` with the rest of the row and is remembered; this file only
 *  says which of them is in hand and reaches for it. What is here is the colour a
 *  card or a shape is given, which is the other question the dots answer and a
 *  different one: ink is drawn in whatever you are writing with, and a card is
 *  coloured after the fact. */

import { type InkTool, INK_TOOLS } from './format'
import { nibFor, pens } from './pens.svelte'
import { DEFAULT_INK } from './palette'
import { type Tool } from './pointer'

class Tools {
  /** What a press on the plane means. */
  which = $state<Tool>('select')

  /** The colour the next card, shape or connector is given. */
  colour = $state<string>(DEFAULT_INK)

  /** Whether the tool goes back to the arrow after one use, which is what a
   *  hand that puts down one card expects and a hand drawing ten does not. */
  sticky = $state(false)

  /** The pen as the pointer machine wants it. */
  get ink(): { tool: InkTool; size: number; color: string; opacity: number } {
    const nib = pens.current
    return { tool: nib.tool, size: nib.size, color: nib.colour, opacity: nib.opacity }
  }

  /** A tool chosen. Choosing a pen twice pins it, which is how one press means
   *  "draw" and a second means "and keep drawing". */
  choose(tool: Tool) {
    if (this.which === tool && drawn(tool)) this.sticky = !this.sticky
    else this.sticky = drawn(tool)

    this.which = tool
  }

  /** A kind of nib chosen, which also turns the tool to drawing: picking a
   *  highlighter and then having to press "draw" is a step nobody would guess at.
   *  The pen in hand becomes one of these, as it comes, in the colour it was
   *  already writing in. */
  choosePen(tool: InkTool) {
    pens.set(nibFor(tool, pens.current.colour))
    this.drawing()
  }

  /** One of the pens the hand keeps, out. */
  pickPen(index: number) {
    pens.pick(index)
    this.drawing()
  }

  /** Back to the arrow, unless the tool was pinned. Called when a tool has done
   *  the one thing it was picked for. */
  done() {
    if (!this.sticky) this.which = 'select'
  }

  private drawing() {
    this.which = 'draw'
    this.sticky = true
  }
}

/** Whether a tool is one somebody uses over and over rather than once. */
function drawn(tool: Tool): boolean {
  return tool === 'draw' || tool === 'erase' || tool === 'lasso' || tool === 'hand'
}

export const tools = new Tools()

/** The pens the bar offers, in the order it shows them, and the widths the
 *  compact bar offers. Four widths is as many choices as anybody wants while
 *  writing; the pen's own popover has the slider for the rest. */
export const PENS = INK_TOOLS
export const INK_SIZES = [1.5, 3, 6, 12] as const
