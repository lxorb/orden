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

/** Whether the numbers are up: exactly while Alt is held, on its own or going from tab to
 *  tab with its digits.
 *
 *  Emil, 2026-10-01: *"It should always display, even if I press and hold Alt and then
 *  press a number. The only condition should be Alt held."* Alt going down shows them,
 *  and so does a digit pressed with Alt alone, which catches an Alt that went down where
 *  the window could not hear it. A digit keeps them, so a hand stepping Alt+1, Alt+2,
 *  Alt+3 sees where it is going all the way.
 *
 *  AltGr never shows them - a German or Swiss keyboard types `@`, `[` and `{` with it,
 *  and Windows says it as Ctrl and Alt - and nor does Alt with Shift, the system's switch
 *  between keyboards. Any other key pressed with Alt ends the hold, which is Alt+F4,
 *  Alt+Tab, Alt and an arrow: the chord is about something else, and a repeat of the
 *  still held Alt does not bring them back until Alt has been let go of. So does a press
 *  of the pointer or the wheel (`spent`), and Alt let go of or the window losing the
 *  keyboard (`released`). A held Alt repeats, and a repeat is the same hold - flagged as
 *  one or not, since an engine that did not flag it would otherwise start over.
 *
 *  And Alt pressed again a moment after a quick tap of it is the second half of Alt Alt,
 *  the tab overview's key (#331), not a hold: the numbers would flash over the tabs
 *  just as they become windows. So it shows nothing; the first tap still does, which a
 *  tap of Alt alone always has. */
export class AltHold {
  holding = false
  /** Alt is still down, but the hold was used for something else. */
  private spent = false
  /** When the last quick tap of Alt alone was let go of, and when Alt went down. */
  private tapped = Number.NEGATIVE_INFINITY
  private since = Number.NEGATIVE_INFINITY
  /** Alt is down as a tap that followed a tap, showing nothing. */
  private quiet = false

  /** A key went down. Answers whether the numbers are to be put where the tabs are now:
   *  on a hold beginning, and on a digit or a letter an Essential wears (`claimed`, see
   *  letters.ts), which have just moved what is in front - a hand going from one to the
   *  next with Alt still down sees where it is going, as with the digits. */
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

    if (stroke.altKey && alone && (isDigit(stroke) || claimed)) {
      this.holding = true
      this.spent = false
      return true
    }

    // Any other key: with Alt down it is a chord of its own, and the hold is over; with
    // no Alt down there was none.
    this.spent = this.spent || this.holding || stroke.altKey
    this.holding = false
    this.quiet = false
    // A key between two taps of Alt makes them no double tap.
    this.tapped = Number.NEGATIVE_INFINITY
    return false
  }

  /** A press of the pointer or the wheel, with Alt still down. */
  used(): void {
    this.spent = this.spent || this.holding
    this.holding = false
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
}
