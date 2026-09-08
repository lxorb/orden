/** What the bar is set to, for every canvas at once.
 *
 *  One pen across the app rather than one per tab: somebody who picked a green
 *  highlighter picked a green highlighter, and opening a second plane is not a
 *  reason to hand them a black biro again. Held for the sitting and not written
 *  anywhere, because a tool is what your hand is doing now, not a preference.
 *
 *  The pen keeps a colour and a size of its own, apart from the six dots that
 *  colour cards: ink is drawn in whatever you are writing with, and a card is
 *  coloured after the fact. Two different questions, two different answers. */

import { type InkTool, INK_TOOLS } from './format'
import { INK_STYLES } from './ink'
import { DEFAULT_INK } from './palette'
import { type Tool } from './pointer'

class Tools {
  /** What a press on the plane means. */
  which = $state<Tool>('select')

  /** Which pen, and how it is set. */
  pen = $state<InkTool>('pen')
  size = $state<number>(INK_STYLES.pen.size)
  colour = $state<string>(DEFAULT_INK)

  /** Whether the tool goes back to the arrow after one use, which is what a
   *  hand that puts down one card expects and a hand drawing ten does not. */
  sticky = $state(false)

  /** The pen as the pointer machine wants it. */
  get ink(): { tool: InkTool; size: number; color: string } {
    return { tool: this.pen, size: this.size, color: this.colour }
  }

  /** A tool chosen. Choosing a pen twice pins it, which is how one press means
   *  "draw" and a second means "and keep drawing". */
  choose(tool: Tool) {
    if (this.which === tool && drawn(tool)) this.sticky = !this.sticky
    else this.sticky = drawn(tool)

    this.which = tool
  }

  /** A pen chosen, which also turns the tool to drawing: picking a highlighter
   *  and then having to press "draw" is a step nobody would guess at. */
  choosePen(pen: InkTool) {
    this.pen = pen
    this.size = INK_STYLES[pen].size
    this.which = 'draw'
    this.sticky = true
  }

  /** Back to the arrow, unless the tool was pinned. Called when a tool has done
   *  the one thing it was picked for. */
  done() {
    if (!this.sticky) this.which = 'select'
  }
}

/** Whether a tool is one somebody uses over and over rather than once. */
function drawn(tool: Tool): boolean {
  return tool === 'draw' || tool === 'erase' || tool === 'lasso' || tool === 'hand'
}

export const tools = new Tools()

/** The pens the bar offers, in the order it shows them, and the widths. Four
 *  widths is as many choices as anybody wants while writing. */
export const PENS = INK_TOOLS
export const INK_SIZES = [1.5, 3, 6, 12] as const
