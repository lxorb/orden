/** Which number each tab wears while Alt is held, and when Alt counts as held.
 *
 *  Emil, 2026-09-30: *"while holding alt it should (in a 'dezent' way) also show the
 *  numbers for the different tabs, but not too much overlaying with what the tabs
 *  are."* The numbers are the Alt and a digit keys (see `ALT_NUMBERED` in
 *  shortcuts/registry.ts), read off the registry as they are bound now, so a number is
 *  never one the key does not keep. Pure; numbers.svelte.ts is what shows them. */

import { WITHIN } from '../double-tap'
import type { Platform } from '../keys'
import { underAlt } from './letters'

/** The keys, and the place along the strip each goes to. Eight places, the ninth, and
 *  the last, which Alt+0 goes to. */
const PLACES: readonly (readonly [string, number | 'last'])[] = [
  ...Array.from({ length: 8 }, (_, at) => [`app.note-${at + 1}.alt`, at] as const),
  ['app.note-ninth', 8],
  ['app.note-9.alt', 'last'],
]

/** The number each of a strip's `count` tabs wears, in its order, or null for a tab no
 *  key reaches. The first eight wear their places and the ninth its own, since Alt+9
 *  goes to the ninth; the last tab wears the key that always means the last - 0 - even
 *  where its place has a number too, because that is the one worth learning. Pinned
 *  tabs count, as the keys count them. */
export function numerals(
  count: number,
  keyFor: (id: string) => string | null,
  platform: Platform,
): (string | null)[] {
  const worn: (string | null)[] = Array.from({ length: count }, () => null)

  for (const [id, place] of PLACES) {
    const said = underAlt(keyFor(id), platform)
    const at = place === 'last' ? count - 1 : place
    if (said !== null && at >= 0 && at < count) worn[at] = said
  }

  return worn
}

/** A key as the hold reads it. */
export interface Stroke {
  key: string
  /** Where it is on the keyboard, which a digit is known by on a layout whose top row
   *  types something else: an AZERTY `&` is Digit1. */
  code: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
  /** AltGr, which some keyboards name apart from Ctrl and Alt. */
  altGraph: boolean
}

/** A digit on the top row, the keys Alt goes to a tab with. Not the number pad's: Alt and
 *  those type a character by its code on Windows. */
function isDigit(stroke: Stroke): boolean {
  return (
    /^Digit\d$/.test(stroke.code) || (/^\d$/.test(stroke.key) && !stroke.code.startsWith('Numpad'))
  )
}

/** Whether the numbers are up: exactly while Alt is held, and nothing else (#1053).
 *
 *  Emil, 2026-10-01: *"It should always display, even if I press and hold Alt and then
 *  press a number. The only condition should be Alt held."* And #1053: switching tabs or
 *  panes does not put them away, nor a digit, nor any other key, nor the pointer, nor the
 *  keyboard going into a web page or a terminal - only Alt let go of.
 *
 *  So the hold is one piece of state, fed by every word there is of Alt: Alt going down
 *  (`down`) and up (`released`), and every key and every press of the pointer, which say
 *  whether Alt is down as they happen (`sense`) - the correction for an Alt let go of
 *  where the window could not hear it, after Alt+Tab or inside a page, and for one that
 *  went down there. A key while it is held answers that the numbers be put where the
 *  tabs are now, since a digit, a letter (#1051) or a pane's key (#1033) may just have
 *  moved what is in front.
 *
 *  AltGr never shows them - a German or Swiss keyboard types `@`, `[` and `{` with it,
 *  and Windows says it as Ctrl and Alt - and nor does Alt with Shift, the system's switch
 *  between keyboards: an Alt that went down with either is `spent` until it is let go of.
 *  A held Alt repeats, and a repeat is the same hold - flagged as one or not, since an
 *  engine that did not flag it would otherwise start over.
 *
 *  And Alt pressed again a moment after a quick tap of it is the second half of Alt Alt,
 *  the tab overview's key (#331), not a hold: the numbers would flash over the tabs
 *  just as they become windows. So it shows nothing; the first tap still does, which a
 *  tap of Alt alone always has. */
export class AltHold {
  holding = false
  /** Alt is down, but went down with AltGr or Shift, or as Alt Alt's second tap. */
  private spent = false
  /** When the last quick tap of Alt alone was let go of, and when Alt went down. */
  private tapped = Number.NEGATIVE_INFINITY
  private since = Number.NEGATIVE_INFINITY
  /** Alt is down as a tap that followed a tap, showing nothing. */
  private quiet = false

  /** A key went down. Answers whether the numbers are to be put where the tabs are now:
   *  on a hold beginning, and on any key while it lasts. `claimed` is a letter an
   *  Essential wears (see letters.ts), which begins a hold as a digit does. */
  down(stroke: Stroke, now = Number.NaN, claimed = false): boolean {
    const alone = !stroke.ctrlKey && !stroke.shiftKey && !stroke.metaKey && !stroke.altGraph

    if (stroke.key === 'Alt') {
      if (stroke.repeat || this.holding || this.spent) return false
      this.since = now
      if (now - this.tapped <= WITHIN) {
        this.spent = true
        this.quiet = alone
        return false
      }
      this.holding = alone
      this.spent = !alone
      return this.holding
    }

    // A key between two taps of Alt makes them no double tap.
    this.tapped = Number.NEGATIVE_INFINITY
    if (!stroke.altKey) {
      this.forget()
      return false
    }
    if (this.holding) return true
    // A digit or an Essential's letter with Alt alone is a hold: Alt went down where
    // the window could not hear it - in a page, or in another program - or went down
    // spent, and the hand is going from tab to tab with it all the same.
    if (!alone || !(isDigit(stroke) || claimed)) return false
    this.holding = true
    this.spent = false
    this.quiet = false
    return true
  }

  /** What any key or press of the pointer says of Alt as it happens: let go of where the
   *  window did not hear it, or held where it did not hear it go down. Answers whether the
   *  numbers are to be put up now. */
  sense(alt: boolean, altGraph = false): boolean {
    if (!alt) {
      this.forget()
      return false
    }
    if (this.holding || this.spent || altGraph) return false
    this.holding = true
    return true
  }

  /** Alt let go of, or the window gone and with it any word of the release. */
  released(now = Number.NaN): void {
    // A quick tap, alone: the first half of what may be Alt Alt.
    const tap = (this.holding || this.quiet) && now - this.since <= WITHIN
    this.tapped = tap ? now : Number.NEGATIVE_INFINITY
    this.quiet = false
    this.holding = false
    this.spent = false
  }

  /** Alt is up, whatever was heard of it: no hold, and no tap waiting for its second. */
  private forget() {
    this.holding = false
    this.spent = false
    this.quiet = false
  }
}
