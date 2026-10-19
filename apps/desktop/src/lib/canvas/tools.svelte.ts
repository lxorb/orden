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

import { type InkTool } from './format'
import { nibFor, pens } from './pens.svelte'
import { DEFAULT_INK } from './palette'
import { type Tool } from './pointer'

/** How long a tool's key may be down and still be a tap, in milliseconds: a key held
 *  longer, or used while it is down, is held. */
export const HOLD = 250

/** The tools whose key, held, is the tool only for as long as it is down (#349). The
 *  lasso alone: a selection is caught on the way to doing something else with the
 *  hand. */
const SPRUNG: ReadonlySet<Tool> = new Set<Tool>(['lasso'])

/** A key as the hold reads it: which physical key, whether it is the keyboard
 *  repeating, and when. */
interface Held {
  code: string
  repeat?: boolean
  timeStamp: number
}

class Tools {
  /** What a press on the plane means. */
  which = $state<Tool>('select')

  /** The colour the next card, shape or connector is given. */
  colour = $state<string>(DEFAULT_INK)

  /** The pen as the pointer machine wants it. */
  get ink(): { tool: InkTool; size: number; color: string; opacity: number } {
    const nib = pens.current
    return { tool: nib.tool, size: nib.size, color: nib.colour, opacity: nib.opacity }
  }

  /** A tool chosen. Pressing the one already in hand is the bar's business rather
   *  than this store's: it opens that tool's own panel, and the tool stays put. */
  choose(tool: Tool) {
    this.which = tool
  }

  /** A sprung tool's key down, and what was in hand before it. */
  private spring: { code: string; was: Tool; at: number; used: boolean } | null = null

  /** A tool's own key, pressed. Tapped it puts the tool in hand as a button does;
   *  held, the lasso is in hand only until the key comes up, and then the tool before
   *  it is back - Photoshop's spring-loaded keys, on the lasso's own key, so moving
   *  the key in Settings › Keyboard moves both (#349). */
  pressed(tool: Tool, key: Held) {
    if (key.repeat) return
    this.spring =
      SPRUNG.has(tool) && this.which !== tool
        ? { code: key.code, was: this.which, at: key.timeStamp, used: false }
        : null
    this.choose(tool)
  }

  /** Something done with the tool while its key is still down, which makes the press
   *  a hold however short it was. */
  used() {
    if (this.spring) this.spring.used = true
  }

  /** A key let go of: a sprung tool's key, held, hands back the tool before it. What
   *  it caught stays caught. */
  released(key: Held) {
    const spring = this.spring
    if (spring?.code !== key.code) return

    this.spring = null
    if (!SPRUNG.has(this.which)) return
    if (spring.used || key.timeStamp - spring.at >= HOLD) this.which = spring.was
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

  /** Back to the arrow, unless the tool is one somebody uses over and over.
   *  Called when a tool has done the one thing it was picked for: a card put down
   *  is a card you now want to move and write in, and a hand that has just drawn a
   *  line is a hand about to draw another. */
  done() {
    if (!drawn(this.which)) this.which = 'select'
  }

  private drawing() {
    this.which = 'draw'
  }
}

/** Whether a tool is one somebody uses over and over rather than once. */
function drawn(tool: Tool): boolean {
  return tool === 'draw' || tool === 'erase' || tool === 'lasso' || tool === 'hand'
}

export const tools = new Tools()
