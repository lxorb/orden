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

/** Which way the interface is reading right now, off the root element - which is
 *  where `i18n.load` writes it and where every mirroring rule reads it.
 *
 *  For the handful of places that measure the screen themselves and cannot be
 *  told by a stylesheet: the drawer's swipe, the sidebar's resize edge, the
 *  overlay scrollbar, a table's column drag. A component with a store to hand
 *  reads `i18n.direction` instead, which is the same answer and reactive. */
export function reading(): Direction {
  if (typeof document === 'undefined') return 'ltr'
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
}

/** The factor for whichever way the interface is reading now. */
export function readingFactor(): number {
  return factorOf(reading())
}

/** The arrow a press means, in reading terms rather than in screen terms.
 *
 *  Right is "further along" everywhere a list runs across the window or a tree
 *  opens to one side: the next tab, into a folder, into a submenu. Under an
 *  interface that reads right to left all three of those go the other way - the
 *  next tab is to the left, and the mark on a closed folder points that way too -
 *  so the two keys trade places and every list that walks sideways gets it at
 *  once. Up and down are not here: a list still runs down the screen.
 *
 *  The keys on the keyboard are not renamed by this: Left still moves left. What
 *  changes is which of the two means "in" and which means "out". */
export function steppedKey(key: string): string {
  if (reading() === 'ltr') return key
  if (key === 'ArrowLeft') return 'ArrowRight'
  if (key === 'ArrowRight') return 'ArrowLeft'
  return key
}

/** Letters read right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan
 *  and the Arabic presentation forms. Enough to recognise a name written in one
 *  of them, which is all the rule below asks of it. */
const RIGHT_TO_LEFT_LETTER = /[\u0590-\u05ff\u0600-\u07bf\u0860-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/
/** Letters read left to right. Latin, Greek and Cyrillic cover what a name in an
 *  Arabic interface is actually written in. */
const LEFT_TO_RIGHT_LETTER = /[A-Za-z\u00c0-\u02af\u0370-\u052f]/

/** One name, count or path put into a sentence, kept to itself.
 *
 *  A sentence carries the direction of the language it is written in; a name in
 *  it may be written in the other one. Left alone, the algorithm that lays out
 *  mixed text hands the name's own punctuation to the sentence, so a note called
 *  `khutta.md` in an Arabic sentence shows its `.md` at the wrong end of the name,
 *  and a bracket or a slash around a Latin path jumps to the other side of it.
 *
 *  This is `<bdi>` for a string, for the sentences that are text rather than
 *  markup: `U+2068 FIRST STRONG ISOLATE` says "this run reads whichever way its
 *  own first letter reads, and nothing inside it reaches out", and `U+2069 POP
 *  DIRECTIONAL ISOLATE` ends it. Where the value already reads the way the
 *  sentence does there is nothing to isolate and nothing is added, so an English
 *  string in an English interface comes out exactly as it was written. */
export function isolated(value: string, direction: Direction): string {
  const otherWay =
    direction === 'rtl' ? LEFT_TO_RIGHT_LETTER.test(value) : RIGHT_TO_LEFT_LETTER.test(value)
  return otherWay ? `\u2068${value}\u2069` : value
}
