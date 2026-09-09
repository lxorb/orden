/** The panel, and the bands a page is set in.
 *
 *  576 by 288 pixels and a fixed 27 pixel line, so a panel is ten lines and not
 *  one more. This is where those ten are spent, and it is one file because both
 *  ends of the plugin have to agree on it to the pixel: the pager fills the body
 *  with exactly as many rows as the body holds, and the app builds the containers
 *  those rows are sent to.
 *
 *  ```
 *   2  ┌───────────────────────────────────────────────────┬────┐
 *      │ THE SECTION                                       │ ●  │  head, mic
 *  29  ├───────────────────────────────────────────────────┴────┤
 *      │ ═══════════════════════════════════════════════════════ │  rule
 *  56  ├────┬───────────────────────────────────────────────────┤
 *      │ 12 │ seven lines of the note, wrapped where the         │
 *      │ 13 │ firmware would wrap them, with the note's own      │  nums, body
 *      │ 14 │ line numbers in a column of their own             │
 * 245  ├────┴───────────────────────────────────────────────────┤
 * 256  │ what the gesture would do                        3/12  │  foot
 * 283  └────────────────────────────────────────────────────────┘
 *  ```
 *
 *  Three of the ten lines are the page's own furniture and seven are the note.
 *  That is a deliberate trade: the rule is the only structure a panel with one
 *  font in one size has, and a section heading that stays put while its pages turn
 *  is what makes the glasses read as a document rather than as a scroll.
 *
 *  **The geometry never changes while a page is up.** A container's position and
 *  size are fixed when the page is made and can only be changed by rebuilding it,
 *  which costs a flat 165 ms. So every screen the plugin shows uses these same
 *  bands - the note, the sidebar, the modal, the two pickers, an answer from the
 *  model - and each of them is then a `textContainerUpgrade` of about 83 ms with
 *  no rebuild at all. That is why a gesture answers at once.
 *
 *  The one thing that does move the geometry is the line numbers, because a text
 *  container has no alignment of any kind: numbers padded into the body's own text
 *  put the words of each row at a slightly different pixel - eleven of them,
 *  measured, since padding is spent in five pixel spaces and a `1` is four pixels
 *  narrower than a `9`. A column of their own is the only way the body has a
 *  straight left edge. Turning them on or off rebuilds the page, once, which is a
 *  fair price for a setting nobody changes twice a day. */

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

/** How many of the firmware's lines the body holds. */
export const BODY_ROWS = 7

/** How wide the column of line numbers is, and the gap after it.
 *
 *  Forty eight pixels is four digits of the widest kind, so every note up to ten
 *  thousand lines has its numbers in full. Longer than that and the number is cut
 *  with an ellipsis rather than allowed to run into the words. */
const NUMS_WIDTH = 48
const NUMS_GAP = 6

/** One band of the panel: where it is and how big. */
export interface Band {
  x: number
  y: number
  width: number
  height: number
}

export type BandName = 'head' | 'mic' | 'rule' | 'nums' | 'body' | 'foot'

/** Where the bands are, given whether the reader asked for line numbers.
 *
 *  `nums` is zero wide when they did not, and the app then leaves the container
 *  out of the page entirely rather than sending a blank one on every page turn. */
export function bandsOf(lineNumbers: boolean): Record<BandName, Band> {
  const gutter = lineNumbers ? NUMS_WIDTH + NUMS_GAP : 0
  const rows = BODY_ROWS * LINE

  return {
    // The section heading, the screen's title, or the question that was asked.
    head: { x: MARGIN, y: 2, width: PANEL_WIDTH - MARGIN - 42, height: LINE },
    // A corner for one glyph, lit while the microphone is open.
    mic: { x: PANEL_WIDTH - 34, y: 2, width: 26, height: LINE },
    // Heavy under a first level heading, light under anything else.
    rule: { x: MARGIN, y: 29, width: PANEL_WIDTH - 2 * MARGIN, height: LINE },
    nums: { x: MARGIN, y: 56, width: lineNumbers ? NUMS_WIDTH : 0, height: rows },
    body: {
      x: MARGIN + gutter,
      y: 56,
      width: PANEL_WIDTH - 2 * MARGIN - gutter,
      height: rows,
    },
    // What the gesture in front of the reader would do, and where they are.
    foot: { x: MARGIN, y: 256, width: PANEL_WIDTH - 2 * MARGIN, height: LINE },
  }
}

/** How wide the body is when the line numbers are off. What a screen that is not
 *  a note - the sidebar, the modal, an answer - is always laid out to, since none
 *  of them has line numbers. */
export const BODY_INNER = PANEL_WIDTH - 2 * MARGIN

/** How bright each band is set, from the firmware's five levels.
 *
 *  The head and the body are the note and get the top level. The rule, the
 *  numbers and the foot are furniture and are stepped down, so a glance at the
 *  panel lands on the words rather than on the page number. Brightness is the only
 *  typographic weight a single font has, and it is worth spending carefully. */
export const BRIGHT: Record<BandName, number> = {
  head: 4,
  mic: 3,
  rule: 2,
  nums: 2,
  body: 4,
  foot: 2,
}
