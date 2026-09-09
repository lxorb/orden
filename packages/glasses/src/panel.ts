/** The panel, and the bands a page is set in.
 *
 *  576 by 288 pixels and a fixed 27 pixel line, so a panel is ten lines and not
 *  one more. This is where those ten are spent, and it is one file because both
 *  ends of the plugin have to agree on it to the pixel: the pager fills the body
 *  with exactly as many rows as the body holds, and the app builds the containers
 *  those rows are sent to.
 *
 *  ```
 *   2  ┌──────────────────────────────────────────┬────────┬────┐
 *      │ THE SECTION                              │  3/12  │ ●  │  head, mic
 *  29  ├──────────────────────────────────────────┴────────┴────┤
 *      │ ═══════════════════════════════════════════════════════ │  rule
 *  56  ├────┬───────────────────────────────────────────────────┤
 *      │ 12 │ eight lines of the note, wrapped where the         │
 *      │ 13 │ firmware would wrap them, with the note's own      │  nums, body
 *      │ 14 │ line numbers in a column of their own              │
 * 272  └────┴───────────────────────────────────────────────────┘
 *  ```
 *
 *  Two of the ten lines are the page's own furniture and eight are the note. It
 *  was three and seven: the last line held the note's name and which page of how
 *  many. Emil, having read on a pair: "I don't want to use the last line for
 *  showing stuff like the page number or whether voice mode is on. That should all
 *  be part of the top." So it is, and the last line of the panel is the note.
 *
 *  The rule is the only structure a panel with one font in one size has, and a
 *  section heading that stays put while its pages turn is what makes the glasses
 *  read as a document rather than as a scroll. Those two are worth a line each; a
 *  page number is not worth a third.
 *
 *  **The geometry never changes.** A container's position and size are fixed when
 *  the page is made and can only be changed by rebuilding it, which costs a flat
 *  165 ms. So every screen the plugin shows uses these same bands - the note, the
 *  sidebar, the modal, the two pickers, an answer from the model - and each of them
 *  is then a `textContainerUpgrade` of about 83 ms with no rebuild at all. That is
 *  why a gesture answers at once.
 *
 *  The line numbers are the one thing that needed thinking about, because a text
 *  container has no alignment of any kind. Padded into the body's own text they put
 *  the words of each row at a slightly different pixel - eleven of them, measured,
 *  since padding is spent in five pixel spaces and a `1` is four pixels narrower
 *  than a `9`. So they have a container of their own, laid **over** the left of the
 *  body rather than beside it, and the note's rows carry a constant indent to clear
 *  it. A constant indent has no jitter in it, and every screen that is not a note
 *  keeps the whole width of the panel. */

/** The whole canvas the glasses draw, in pixels. Wide and short, which is the one
 *  fact that shapes everything: a note is set across the full width rather than
 *  down a column, because a column would throw away two thirds of the glass. */
export const PANEL_WIDTH = 576
export const PANEL_HEIGHT = 288

/** The firmware's line, in pixels. Fixed, and not ours to choose. */
export const LINE = 27

/** Room down each side. Eight, because 576 less two of them is 560, and 560 is
 *  exactly twenty eight box drawing glyphs: a rule reaches the same pixel the
 *  last character of a full line reaches. */
const MARGIN = 8

/** How many of the firmware's lines the body holds.
 *
 *  Eight. It was seven, and the eighth used to be the foot: the note's name and
 *  which page of how many. Emil, having read on a pair: "I don't want to use the
 *  last line for showing stuff like the page number or whether voice mode is on.
 *  That should all be part of the top." He is right, and it is worth more than the
 *  tidiness - it is a seventh more of every note on every page, for ever. So the
 *  page number sits at the right of the head band beside the microphone's corner,
 *  and the last line of the panel is the note. */
export const BODY_ROWS = 8

/** How wide the column of line numbers is, and the gap after it.
 *
 *  Forty eight pixels is four digits of the widest kind, so every note up to ten
 *  thousand lines has its numbers in full. Longer than that and the number is cut
 *  with an ellipsis rather than allowed to run into the words. */
const NUMS_WIDTH = 48
const NUMS_GAP = 6

/** How far a note's own rows are pushed in to clear that column. Zero when the
 *  reader asked for no numbers, and the body then starts at the margin. */
export const GUTTER = NUMS_WIDTH + NUMS_GAP

/** One band of the panel: where it is and how big. */
export interface Band {
  x: number
  y: number
  width: number
  height: number
}

export type BandName = 'head' | 'mic' | 'rule' | 'nums' | 'body'

/** Where the bands are, given whether the reader asked for line numbers.
 *
 *  Only `nums` moves: it is zero wide when they did not ask, and the app then
 *  leaves the container out of the page entirely rather than sending a blank one on
 *  every page turn. Everything else is the same on every screen, which is what lets
 *  a screen change cost two sends and no rebuild. */
export function bandsOf(lineNumbers: boolean): Record<BandName, Band> {
  const rows = BODY_ROWS * LINE

  return {
    // The section heading, the screen's title, or the question that was asked.
    head: { x: MARGIN, y: 2, width: PANEL_WIDTH - MARGIN - 42, height: LINE },
    // A corner for one glyph, lit while the microphone is open.
    mic: { x: PANEL_WIDTH - 34, y: 2, width: 26, height: LINE },
    // Heavy under a first level heading, light under anything else.
    rule: { x: MARGIN, y: 29, width: PANEL_WIDTH - 2 * MARGIN, height: LINE },
    // Over the left of the body rather than beside it; the note's own rows carry a
    // constant indent to clear it. See the header above.
    nums: { x: MARGIN, y: 56, width: lineNumbers ? NUMS_WIDTH : 0, height: rows },
    body: { x: MARGIN, y: 56, width: PANEL_WIDTH - 2 * MARGIN, height: rows },
  }
}

/** How wide the body is: the whole panel less its margins, on every screen. */
export const BODY_INNER = PANEL_WIDTH - 2 * MARGIN

/** How wide the head is: the same, less the corner the microphone's dot sits in.
 *  What the section and the page number are spread across. */
export const HEAD_INNER = PANEL_WIDTH - MARGIN - 42

/** How bright each band is set, from the firmware's five levels.
 *
 *  The head and the body are the note and get the top level. The rule and the
 *  numbers are furniture and are stepped down, so a glance at the
 *  panel lands on the words rather than on the page number. Brightness is the only
 *  typographic weight a single font has, and it is worth spending carefully. */
export const BRIGHT: Record<BandName, number> = {
  head: 4,
  mic: 3,
  rule: 2,
  nums: 2,
  body: 4,
}
