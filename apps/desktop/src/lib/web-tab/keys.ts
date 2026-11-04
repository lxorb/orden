/** A key pressed inside a web tab's page that the page does not get: the browser's own.
 *
 *  Emil, 2026-09-27: *"if I press Ctrl+T right now while I'm in a browser window,
 *  nothing happens."* The page is a webview of its own, so the key went to the site.
 *  The crate now takes the chords every browser keeps for itself - a new tab, closing
 *  one, going round them, moving one along, reopening the last, a new window, F6 to the
 *  address field - before the page sees them, hands the keyboard back to the app, and
 *  says which key it was; see web_keys.rs. It also says when a modifier is let go of
 *  inside the page, and Ctrl+D once the page has let it go by, which Chrome gives the
 *  page first; see web_opens.rs.
 *
 *  What arrives is played on the window as the key it was, so every chord answers the
 *  way it does anywhere else in the app - through App.svelte's own handler, the
 *  registry and a reader's own bindings - and nothing here has a list of what the keys
 *  mean. A terminal plays a key the same way once it has asked whose it is; see
 *  terminal/two-ways.ts. */

import { parseCombination, type Platform } from '../keys'
import { isRecord } from '../stored'

/** A key as the crate names it: `KeyboardEvent`'s own words for it. */
export interface Pressed {
  key: string
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  repeat: boolean
  /** Pressed rather than let go of. */
  down: boolean
}

/** What the crate said, read rather than trusted, like everything that crosses that
 *  line. */
export function readPressed(value: unknown): Pressed | null {
  if (!isRecord(value)) return null

  const { key, code, ctrl, shift, alt, repeat, down } = value
  if (typeof key !== 'string' || !key || typeof code !== 'string') return null

  return {
    key,
    code,
    ctrl: ctrl === true,
    shift: shift === true,
    alt: alt === true,
    repeat: repeat === true,
    down: down === true,
  }
}

/** The keys played here, which is what tells a key the page had the keyboard for from
 *  the same key pressed in the app. Only F6 asks: in the app it walks the regions, and
 *  from inside a page it is Chrome's way back to the address field. */
const played = new WeakSet<Event>()

/** Whether a key was pressed inside a page rather than in the app. */
export function fromPage(event: Event): boolean {
  return played.has(event)
}

/** The key, played on the window as if it had been pressed there. On the window rather
 *  than on whatever has the keyboard, because the page had the keyboard and nothing in
 *  this document was aimed at: the app's own keys are read off the window. */
export function replay(one: Pressed): void {
  const event = new KeyboardEvent(one.down ? 'keydown' : 'keyup', {
    key: one.key,
    code: one.code,
    ctrlKey: one.ctrl,
    shiftKey: one.shift,
    altKey: one.alt,
    repeat: one.repeat,
    bubbles: true,
    cancelable: true,
  })
  played.add(event)
  window.dispatchEvent(event)
}

/** A chord the app takes from a page, as the crate is asked for it (`web_keys_take` in
 *  web_keys.rs): where the key is, and what is held with it. */
export interface Taken {
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

/** A key bound in the app as one to take from a page: a letter or a digit held with Ctrl
 *  or Alt. Null for anything else, which a page keeps: a key with Cmd, a named key, or
 *  one held with neither, which is typing. The crate refuses those too. */
export function takenOf(key: string | null, platform: Platform): Taken | null {
  const combination = key === null ? null : parseCombination(key, platform)
  if (!combination || combination.meta || combination.ctrl === combination.alt) return null

  const letter = /^[a-z]$/.test(combination.key)
  if (!letter && !/^[0-9]$/.test(combination.key)) return null
  const { ctrl, shift, alt } = combination
  const code = letter ? `Key${combination.key.toUpperCase()}` : `Digit${combination.key}`
  return { code, ctrl, shift, alt }
}
