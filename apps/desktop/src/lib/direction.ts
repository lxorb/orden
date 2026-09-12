/** Which way the interface reads, and which way a note does.
 *
 *  Two different questions, and the whole of this batch is keeping them apart.
 *
 *  **The interface** reads whichever way its language reads: Arabic, Persian,
 *  Pashto and Urdu right to left, everything else left to right. That is one
 *  attribute on the root element - `dir` - and every rule that mirrors keys off
 *  it, so the app has one design rather than two layouts.
 *
 *  **A note** reads whichever way it was written, and never follows the
 *  interface. An English note in an Arabic app is still English; an Arabic note
 *  in an English app is still Arabic. The writing surface says so twice: the
 *  note's own `dir` from the Right to left mode, and `unicode-bidi: plaintext` in
 *  the stylesheet, which gives every paragraph the direction of its own first
 *  strong character - so a note with both in it reads right line by line without
 *  anybody setting anything.
 *
 *  The four are the ones nib has catalogues for. Hebrew, Divehi, Kurdish and the
 *  rest read right to left too, and a catalogue for one of them would need adding
 *  here as well - which is why this is a list of language ids rather than a guess
 *  from the script: `Intl.Locale.prototype.getTextInfo` would answer for every
 *  language, and is a year from being in every browser nib runs in. */

/** The languages the app is written in that read right to left. */
export const RIGHT_TO_LEFT: readonly string[] = ['ar', 'fa', 'ps', 'ur']

export type Direction = 'ltr' | 'rtl'

/** Which way a language reads. The tag may carry a region - `ar-EG` - so the
 *  first part is what is asked about. */
export function directionOf(language: string): Direction {
  const base = language.split('-')[0]?.toLowerCase() ?? ''
  return RIGHT_TO_LEFT.includes(base) ? 'rtl' : 'ltr'
}

/** Which way round a movement goes in this direction: forward is to the right in
 *  a left-to-right interface and to the left in a right-to-left one.
 *
 *  What the handful of places that do their own arithmetic multiply by - the
 *  sidebar's resize drag, the drawer's swipe - because those are about the screen
 *  rather than about reading, and a logical property cannot help them. */
export function factorOf(direction: Direction): number {
  return direction === 'rtl' ? -1 : 1
}
